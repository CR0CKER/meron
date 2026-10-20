//! Gmail-style search operators, parsed once and compiled per backend.
//!
//! A query is whitespace-separated terms ANDed together. A term of the form
//! `key:value` with a known key becomes a structured filter; everything else is
//! free text, matched as one substring the way a plain query always was.
//! Values may be double-quoted to hold spaces (`from:"Ann Lee"`). Unknown keys
//! and empty values stay free text, so `re:foo` or a URL still searches as
//! typed. Negation, `OR` and grouping are deliberately not supported.

use chrono::NaiveDate;

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
        let Some((key, value)) = term.split_once(':') else {
            return false;
        };
        let value = unquote(value);
        if value.is_empty() {
            return false;
        }
        match key.to_ascii_lowercase().as_str() {
            "from" => self.from.push(value.to_string()),
            "to" => self.to.push(value.to_string()),
            "subject" => self.subject.push(value.to_string()),
            "is" => match value.to_ascii_lowercase().as_str() {
                "unread" => self.seen = Some(false),
                "read" => self.seen = Some(true),
                "starred" => self.starred = true,
                _ => return false,
            },
            "after" => match parse_date(value) {
                Some(date) => self.after = Some(date),
                None => return false,
            },
            "before" => match parse_date(value) {
                Some(date) => self.before = Some(date),
                None => return false,
            },
            _ => return false,
        }
        true
    }
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
}
