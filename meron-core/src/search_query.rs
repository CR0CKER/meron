//! Gmail-style search operators, parsed once and compiled per backend.
//!
//! A query is whitespace-separated terms ANDed together. A term of the form
//! `key:value` with a known key becomes a structured filter; everything else is
//! free text, matched as one substring the way a plain query always was.
//! Values may be double-quoted to hold spaces (`from:"Ann Lee"`). Unknown keys
//! and empty values stay free text, so `re:foo` or a URL still searches as
//! typed. Negation, `OR` and grouping are deliberately not supported.

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct SearchQuery {
    /// Free text left after operators are taken out, as one substring. Empty
    /// when the query is operators only.
    pub text: String,
    /// `from:` values, matched against the sender's name or address.
    pub from: Vec<String>,
    /// `to:` values, matched against To or Cc.
    pub to: Vec<String>,
    /// `subject:` values.
    pub subject: Vec<String>,
    /// `is:unread` (`Some(false)`) / `is:read` (`Some(true)`).
    pub seen: Option<bool>,
    /// `is:starred`.
    pub starred: bool,
    /// `after:` — sent on or after this day.
    pub after: Option<NaiveDate>,
    /// `before:` — sent before this day.
    pub before: Option<NaiveDate>,
}

impl SearchQuery {
    pub fn parse(query: &str) -> Self {
        let query = query.trim();
        let mut parsed = SearchQuery::default();
        let mut text = Vec::new();
        for term in terms(query) {
            if !parsed.take_operator(term) {
                text.push(term);
            }
        }
        // A query with no operators keeps its exact spacing, so plain search
        // behaves as it always did.
        parsed.text = if text.len() == terms(query).count() {
            query.to_string()
        } else {
            text.join(" ")
        };
        parsed
    }

    pub fn is_empty(&self) -> bool {
        self.text.is_empty() && !self.has_operators()
    }

    pub fn has_operators(&self) -> bool {
        !self.from.is_empty()
            || !self.to.is_empty()
            || !self.subject.is_empty()
            || self.seen.is_some()
            || self.starred
            || self.after.is_some()
            || self.before.is_some()
    }

    /// Record `term` if it is a known operator with a usable value.
    fn take_operator(&mut self, term: &str) -> bool {
        let Some(operator) = Operator::parse(term) else {
            return false;
        };
        match operator {
            Operator::From(value) => self.from.push(value),
            Operator::To(value) => self.to.push(value),
            Operator::Subject(value) => self.subject.push(value),
            Operator::Seen(seen) => self.seen = Some(seen),
            Operator::Starred => self.starred = true,
            Operator::After(date) => self.after = Some(date),
            Operator::Before(date) => self.before = Some(date),
        }
        true
    }
}

/// One recognised `key:value` term.
enum Operator {
    From(String),
    To(String),
    Subject(String),
    Seen(bool),
    Starred,
    After(NaiveDate),
    Before(NaiveDate),
}

impl Operator {
    fn parse(term: &str) -> Option<Self> {
        let (key, value) = term.split_once(':')?;
        let value = unquote(value);
        if value.is_empty() {
            return None;
        }
        Some(match key.to_ascii_lowercase().as_str() {
            "from" => Operator::From(value.to_string()),
            "to" => Operator::To(value.to_string()),
            "subject" => Operator::Subject(value.to_string()),
            "is" => match value.to_ascii_lowercase().as_str() {
                "unread" => Operator::Seen(false),
                "read" => Operator::Seen(true),
                "starred" => Operator::Starred,
                _ => return None,
            },
            "after" => Operator::After(parse_date(value)?),
            "before" => Operator::Before(parse_date(value)?),
            _ => return None,
        })
    }
}

/// The search options form: one field per operator, read from and written
/// back to query text so the text stays the single source of truth. A term the
/// form has no field for (a second `from:`, `is:read`) is kept verbatim in
/// `words`, so opening the form and searching again never drops part of a
/// query.
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct SearchFields {
    pub from: String,
    pub to: String,
    pub subject: String,
    /// Free text, plus any terms the other fields can't hold.
    pub words: String,
    /// `yyyy-mm-dd`, or empty.
    pub after: String,
    /// `yyyy-mm-dd`, or empty.
    pub before: String,
    pub unread: bool,
    pub starred: bool,
}

impl SearchFields {
    pub fn parse(query: &str) -> Self {
        let query = query.trim();
        let mut fields = SearchFields::default();
        let mut words = Vec::new();
        let mut taken = false;
        // The last read-state term decides, as in `SearchQuery`. Only that one
        // survives: `is:unread` in its checkbox, `is:read` in the words, so the
        // rebuilt query can't put them back in an order that flips it.
        let seen = terms(query)
            .filter_map(|term| match Operator::parse(term) {
                Some(Operator::Seen(seen)) => Some(seen),
                _ => None,
            })
            .last();
        for term in terms(query) {
            let slot = match Operator::parse(term) {
                Some(Operator::From(value)) => fill(&mut fields.from, value),
                Some(Operator::To(value)) => fill(&mut fields.to, value),
                Some(Operator::Subject(value)) => fill(&mut fields.subject, value),
                Some(Operator::After(date)) => fill(&mut fields.after, iso(date)),
                Some(Operator::Before(date)) => fill(&mut fields.before, iso(date)),
                Some(Operator::Seen(false)) => {
                    fields.unread |= seen == Some(false);
                    true
                }
                Some(Operator::Seen(true)) => seen != Some(true),
                Some(Operator::Starred) => {
                    fields.starred = true;
                    true
                }
                None => false,
            };
            if slot {
                taken = true;
            } else {
                words.push(term);
            }
        }
        // As in `SearchQuery::parse`, a plain query keeps its exact spacing.
        fields.words = if taken {
            words.join(" ")
        } else {
            query.to_string()
        };
        fields
    }

    /// The query text for these fields: operators, then the words, then
    /// `is:unread` — last, so the checkbox wins over an `is:read` kept in the
    /// words, as the last read-state term is the one that counts.
    pub fn to_query(&self) -> String {
        let mut terms = Vec::new();
        for (key, value) in [
            ("from", &self.from),
            ("to", &self.to),
            ("subject", &self.subject),
        ] {
            let value = value.replace('"', "");
            let value = value.trim();
            if value.is_empty() {
                continue;
            }
            if value.contains(char::is_whitespace) {
                terms.push(format!("{key}:\"{value}\""));
            } else {
                terms.push(format!("{key}:{value}"));
            }
        }
        if self.starred {
            terms.push("is:starred".to_string());
        }
        for (key, value) in [("after", &self.after), ("before", &self.before)] {
            if let Some(date) = parse_date(value.trim()) {
                terms.push(format!("{key}:{}", date.format("%Y/%m/%d")));
            }
        }
        let words = self.words.trim();
        if !words.is_empty() {
            terms.push(words.to_string());
        }
        if self.unread {
            terms.push("is:unread".to_string());
        }
        terms.join(" ")
    }
}

/// `search.parse` / `search.build`, the search options form's round trip,
/// shared by the desktop sidecar and the mobile bridge. `None` for any other
/// method.
pub fn handle_request(method: &str, params: &serde_json::Value) -> Option<serde_json::Value> {
    match method {
        "search.parse" => {
            let query = params
                .get("query")
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default();
            serde_json::to_value(SearchFields::parse(query)).ok()
        }
        "search.build" => {
            let fields: SearchFields =
                serde_json::from_value(params.get("fields").cloned().unwrap_or_default())
                    .unwrap_or_default();
            Some(serde_json::json!({ "query": fields.to_query() }))
        }
        _ => None,
    }
}

/// Put `value` in an empty form field; a full one leaves it to `words`.
fn fill(field: &mut String, value: String) -> bool {
    if !field.is_empty() {
        return false;
    }
    *field = value;
    true
}

fn iso(date: NaiveDate) -> String {
    date.format("%Y-%m-%d").to_string()
}

/// Epoch seconds of local midnight starting `date`, which is what a user means
/// by `after:2026/01/02`. Falls back to UTC midnight for a day that has no
/// local midnight (a DST gap at 00:00).
pub fn local_midnight(date: NaiveDate) -> i64 {
    let midnight = date.and_time(chrono::NaiveTime::MIN);
    midnight
        .and_local_timezone(chrono::Local)
        .earliest()
        .map_or_else(|| midnight.and_utc().timestamp(), |dt| dt.timestamp())
}

/// Split on whitespace, except inside a double-quoted span, so
/// `from:"Ann Lee"` stays one term. An unclosed quote runs to the end.
fn terms(query: &str) -> impl Iterator<Item = &str> {
    let mut rest = query;
    std::iter::from_fn(move || {
        rest = rest.trim_start();
        if rest.is_empty() {
            return None;
        }
        let mut quoted = false;
        let end = rest
            .char_indices()
            .find(|&(_, c)| {
                if c == '"' {
                    quoted = !quoted;
                }
                c.is_whitespace() && !quoted
            })
            .map_or(rest.len(), |(i, _)| i);
        let (term, tail) = rest.split_at(end);
        rest = tail;
        Some(term)
    })
}

fn unquote(value: &str) -> &str {
    let value = value.strip_prefix('"').unwrap_or(value);
    value.strip_suffix('"').unwrap_or(value).trim()
}

/// Gmail's `yyyy/mm/dd`, plus ISO `yyyy-mm-dd`.
fn parse_date(value: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(value, "%Y/%m/%d")
        .or_else(|_| NaiveDate::parse_from_str(value, "%Y-%m-%d"))
        .ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_query_is_unchanged_free_text() {
        let q = SearchQuery::parse("  quarterly  report ");
        assert_eq!(q.text, "quarterly  report");
        assert!(!q.has_operators());
    }

    #[test]
    fn operators_are_taken_out_of_the_text() {
        let q = SearchQuery::parse("from:a@b.c to:d@e.f budget is:unread");
        assert_eq!(q.from, ["a@b.c"]);
        assert_eq!(q.to, ["d@e.f"]);
        assert_eq!(q.text, "budget");
        assert_eq!(q.seen, Some(false));
    }

    #[test]
    fn quoted_values_keep_spaces() {
        let q = SearchQuery::parse(r#"From:"Ann Lee" subject:"Q3 plan" notes"#);
        assert_eq!(q.from, ["Ann Lee"]);
        assert_eq!(q.subject, ["Q3 plan"]);
        assert_eq!(q.text, "notes");
    }

    #[test]
    fn unknown_or_empty_operators_stay_text() {
        let q = SearchQuery::parse("re:foo https://x.y from: is:muted after:soon");
        assert!(!q.has_operators());
        assert_eq!(q.text, "re:foo https://x.y from: is:muted after:soon");
    }

    #[test]
    fn flags_and_dates() {
        let q = SearchQuery::parse("is:starred is:read after:2026/01/02 before:2026-02-03");
        assert!(q.starred);
        assert_eq!(q.seen, Some(true));
        assert_eq!(q.after, NaiveDate::from_ymd_opt(2026, 1, 2));
        assert_eq!(q.before, NaiveDate::from_ymd_opt(2026, 2, 3));
        assert!(q.text.is_empty());
        assert!(!q.is_empty());
    }

    #[test]
    fn fields_round_trip_through_query_text() {
        let fields = SearchFields::parse(
            r#"budget from:"Ann Lee" to:d@e.f is:unread is:starred after:2026/01/02 before:2026-02-03"#,
        );
        assert_eq!(
            fields,
            SearchFields {
                from: "Ann Lee".into(),
                to: "d@e.f".into(),
                subject: String::new(),
                words: "budget".into(),
                after: "2026-01-02".into(),
                before: "2026-02-03".into(),
                unread: true,
                starred: true,
            }
        );
        assert_eq!(
            fields.to_query(),
            r#"from:"Ann Lee" to:d@e.f is:starred after:2026/01/02 before:2026/02/03 budget is:unread"#
        );
        assert_eq!(SearchFields::parse(&fields.to_query()), fields);
    }

    #[test]
    fn fields_keep_terms_they_cannot_hold_in_words() {
        let fields = SearchFields::parse("from:a@b.c from:x@y.z is:read re:foo");
        assert_eq!(fields.from, "a@b.c");
        assert_eq!(fields.words, "from:x@y.z is:read re:foo");
        assert_eq!(fields.to_query(), "from:a@b.c from:x@y.z is:read re:foo");
        // A plain query is all words, spacing intact.
        assert_eq!(SearchFields::parse(" a  b ").words, "a  b");
    }

    #[test]
    fn fields_keep_the_last_read_state() {
        let unread = SearchFields::parse("is:read budget is:unread");
        assert!(unread.unread);
        assert_eq!(unread.words, "budget");
        assert_eq!(SearchQuery::parse(&unread.to_query()).seen, Some(false));

        let read = SearchFields::parse("is:unread is:read budget is:read");
        assert!(!read.unread);
        assert_eq!(read.words, "is:read budget is:read");
        assert_eq!(SearchQuery::parse(&read.to_query()).seen, Some(true));

        // Ticking Unread on a read search wins over the kept `is:read`.
        let ticked = SearchFields {
            unread: true,
            ..SearchFields::parse("is:read budget")
        };
        assert_eq!(SearchQuery::parse(&ticked.to_query()).seen, Some(false));
    }

    #[test]
    fn fields_drop_unusable_values() {
        let fields = SearchFields {
            from: r#" "x" "#.into(),
            subject: "  ".into(),
            after: "soon".into(),
            ..Default::default()
        };
        assert_eq!(fields.to_query(), "from:x");
    }
}
