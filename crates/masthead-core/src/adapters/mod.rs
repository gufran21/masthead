//! One module per agent. Each exposes `discover` (find session files under a root)
//! and `parse_file` (summarise one file into a [`crate::Session`]).

pub mod claude;
pub mod codex;

use std::fs::File;
use std::io::{BufRead, BufReader, Read};
use std::path::Path;

/// Calls `f` for every JSON object line in `path`. Lines that are not valid JSON
/// (for example a half-written last line) are skipped.
pub(crate) fn for_each_json_line(
    path: &Path,
    mut f: impl FnMut(serde_json::Value),
) -> anyhow::Result<()> {
    let file = File::open(path)?;
    let reader: Box<dyn Read> = if path.extension().is_some_and(|e| e == "zst") {
        Box::new(zstd::stream::read::Decoder::new(file)?)
    } else {
        Box::new(file)
    };
    for line in BufReader::new(reader).lines() {
        let Ok(line) = line else { break };
        if line.is_empty() {
            continue;
        }
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) {
            f(value);
        }
    }
    Ok(())
}

/// Extracts the text a message carries: either a plain string or the `text` of
/// the first text block in an array of content blocks.
pub(crate) fn message_text(content: &serde_json::Value) -> Option<&str> {
    if let Some(s) = content.as_str() {
        return Some(s);
    }
    content.as_array()?.iter().find_map(|block| {
        let kind = block.get("type")?.as_str()?;
        if kind == "text" || kind == "input_text" {
            block.get("text")?.as_str()
        } else {
            None
        }
    })
}
