//! A JSON object document that keeps its top-level keys in file order, for editing files the user
//! also edits by hand (a Claude profile's settings.json). serde_json's own maps sort their keys.

use std::fmt;

use serde::de::{MapAccess, Visitor};
use serde::ser::SerializeMap;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;

/// A JSON object that keeps its top-level keys in file order, so an install does not reshuffle a
/// settings file the user edits by hand. Nested objects keep serde_json's own order.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct OrderedDoc(Vec<(String, Value)>);

impl OrderedDoc {
    pub(crate) fn get(&self, key: &str) -> Option<&Value> {
        self.0
            .iter()
            .find(|(name, _)| name == key)
            .map(|(_, value)| value)
    }

    pub(crate) fn set(&mut self, key: &str, value: Value) {
        match self.0.iter_mut().find(|(name, _)| name == key) {
            Some(entry) => entry.1 = value,
            None => self.0.push((key.to_string(), value)),
        }
    }

    pub(crate) fn remove(&mut self, key: &str) {
        self.0.retain(|(name, _)| name != key);
    }
}

impl<'de> Deserialize<'de> for OrderedDoc {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct DocVisitor;
        impl<'de> Visitor<'de> for DocVisitor {
            type Value = OrderedDoc;
            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                formatter.write_str("a JSON object")
            }
            fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<OrderedDoc, A::Error> {
                let mut entries: Vec<(String, Value)> = Vec::new();
                while let Some((key, value)) = map.next_entry::<String, Value>()? {
                    // A repeated key: the last one wins, as in serde_json's own maps.
                    entries.retain(|(name, _)| *name != key);
                    entries.push((key, value));
                }
                Ok(OrderedDoc(entries))
            }
        }
        deserializer.deserialize_map(DocVisitor)
    }
}

impl Serialize for OrderedDoc {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(Some(self.0.len()))?;
        for (key, value) in &self.0 {
            map.serialize_entry(key, value)?;
        }
        map.end()
    }
}
