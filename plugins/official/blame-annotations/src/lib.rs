//! A command toggles the annotations of the focused file; its lens only offers the command.
use std::collections::HashSet;

use omniterm_plugin::language_features::{CodeLens, Document, LanguageFeatures};
use omniterm_plugin::{Decoration, Error, Invocation, Plugin, Position, Range, host, register_plugin};

const SET: &str = "blame";

#[derive(Default)]
pub struct BlameAnnotations {
    /// Files whose annotations are on, so the same command hides them again.
    shown: HashSet<String>,
}
impl Plugin for BlameAnnotations {
    fn run_command(&mut self, _id: &str, ctx: &Invocation, _arg: Option<&str>) -> Result<Option<String>, Error> {
        let editor = ctx.editor().ok_or("Open a text file first")?;
        if self.shown.remove(&editor.path()) {
            host::set_decorations(&editor.path(), SET, &[])?;
            return Ok(None);
        }
        let project = ctx.project().ok_or("Open a project first")?;
        let text = editor.document()?.text;
        let lines: Vec<_> = text.lines().collect();
        let items = project
            .vcs_blame(&editor.path())?
            .into_iter()
            .take(2000)
            .filter_map(|b| {
                let line = lines.get(b.line as usize)?;
                let at = Position::new(b.line, line.encode_utf16().count() as u32);
                Some(Decoration {
                    range: Range::new(at, at),
                    style: "muted".into(),
                    hover: Some(b.summary),
                    after: Some(format!("  {} · {}", b.author, b.commit.chars().take(8).collect::<String>())),
                })
            })
            .collect::<Vec<_>>();
        host::set_decorations(&editor.path(), SET, &items)?;
        self.shown.insert(editor.path());
        Ok(None)
    }
}
impl LanguageFeatures for BlameAnnotations {
    fn code_lenses(&mut self, doc: &Document) -> Vec<CodeLens> {
        let title = if self.shown.contains(&doc.path) { "Hide blame annotations" } else { "Show blame annotations" };
        vec![CodeLens {
            range: Range::default(),
            title: title.into(),
            command: "annotate".into(),
            argument: None,
        }]
    }
}
register_plugin!(BlameAnnotations, language_features);

#[cfg(test)]
mod tests {
    use super::*;
    use omniterm_plugin::{BlameLine, mock::MockHost};
    #[test]
    fn annotations_use_utf16_line_ends_and_require_vcs_permission() {
        let mock = MockHost::install();
        let mut plugin = BlameAnnotations::default();
        mock.open_editor("/project/a.txt", "text", "😀x\n", &[]);
        mock.set_vcs_reads(
            vec![],
            "/project/a.txt",
            vec![BlameLine {
                line: 0,
                commit: "1234567890".into(),
                author: "Ada".into(),
                date: 0,
                summary: "First".into(),
            }],
            None,
        );
        plugin.run_command("annotate", &mock.invocation(), None).unwrap();
        let items = mock.decorations();
        let item = &items.values().next().unwrap()[0];
        assert_eq!(item.range.start.character, 3);
        assert_eq!(item.after.as_deref(), Some("  Ada · 12345678"));
        let lens = |p: &mut BlameAnnotations| {
            p.code_lenses(&Document { path: "/project/a.txt".into(), language: String::new(), version: 1, text: String::new() })
                .remove(0)
                .title
        };
        assert_eq!(lens(&mut plugin), "Hide blame annotations");
        // Running it again hides them.
        plugin.run_command("annotate", &mock.invocation(), None).unwrap();
        assert!(mock.decorations().values().all(Vec::is_empty));
        assert_eq!(lens(&mut plugin), "Show blame annotations");
        drop(mock);
        let mut plugin = BlameAnnotations::default();
        let mock = MockHost::install().with_capabilities(&["project.read", "editor.read"]);
        mock.open_editor("/project/a.txt", "text", "x", &[]);
        assert!(matches!(plugin.run_command("annotate", &mock.invocation(), None), Err(Error::Denied(_))));
    }
}
