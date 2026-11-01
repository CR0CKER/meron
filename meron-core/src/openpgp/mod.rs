//! OpenPGP (PGP/MIME, Autocrypt) for Meron, on rPGP. See nonbili/meron#46.
//!
//! - [`keys`]: generate, parse, unlock and check keys (the policy rPGP leaves to us)
//! - [`crypt`]: decrypt, verify and encrypt messages, with size caps, fail closed
//! - [`autocrypt`]: the headers that carry keys in ordinary mail
//! - [`keyring`]: the in-memory key snapshot the parser and sender use
//! - [`store`]: the SQLCipher tables behind it
//! - [`mime`]: PGP/MIME detection and the decrypted inner message

pub mod autocrypt;
pub mod crypt;
pub mod keyring;
pub mod keys;
pub mod mime;
pub mod store;
