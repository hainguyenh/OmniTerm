/**
 * Languages & Frameworks › Indexing: the project index and how long idle language servers
 * live. OmniTerm is used mostly through terminal agents, so both stay light by default:
 * an untrusted project is never indexed, and servers stop once their files are closed.
 */
import { useEffect, useId, useState } from "react";
import { Input } from "@/ui";
import { SERVER_IDLE_MINUTES } from "@/platform/languageSettings";
import { Row } from "../components/Form";
import { useSetting } from "../components/context";
import { ALL_SYMBOL_LANGUAGES, INDEX_LIMITS, parseLanguageList } from "../model/indexSchema";
import type { PageSpec } from "./spec";
import { LANGUAGES_GROUP } from "./languages";
import styles from "../components/Form.module.css";

export const INDEXING_PAGE_ID = "languages.indexing";

/** `index.symbolLanguages` as a comma-separated list; saved as the user leaves the field. */
function SymbolLanguagesRow() {
  const [value, set] = useSetting<string[]>("index.symbolLanguages");
  const shown = (value ?? []).join(", ");
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);
  const id = useId();
  const commit = () => {
    const next = parseLanguageList(draft);
    if (next.join(", ") !== shown) set(next);
  };
  return (
    <Row
      label="Extract symbols for"
      htmlFor={id}
      hint={`Language ids, comma-separated; "${ALL_SYMBOL_LANGUAGES}" for every language. Other files are still found by name.`}
    >
      <Input
        id={id}
        className={styles.text}
        value={draft}
        placeholder="typescript, rust, python"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
      />
    </Row>
  );
}

export const INDEXING_PAGE: PageSpec = {
  id: INDEXING_PAGE_ID,
  title: "Indexing",
  group: LANGUAGES_GROUP,
  // Right before Language Servers (400).
  order: 399,
  projectScope: true,
  keywords: ["index", "indexing", "go to symbol", "go to file", "language server", "idle", "performance", "trust"],
  sections: [
    {
      title: "Project index",
      options: [
        {
          kind: "toggle",
          key: "index.enabled",
          label: "Index projects",
          hint: "Go to File, Go to Symbol and Find Usages need the index. A project in Restricted Mode is not indexed until you trust it. Applies when the project is opened again.",
        },
        { kind: "custom", label: "Extract symbols for", keywords: ["symbol languages"], component: SymbolLanguagesRow },
        {
          kind: "number",
          key: "index.scanDelayMs",
          label: "Start the first scan after",
          min: INDEX_LIMITS.scanDelayMs.min,
          max: INDEX_LIMITS.scanDelayMs.max,
          step: 500,
          integer: true,
          unit: "ms",
          hint: "Lets the window finish starting before the index reads the project.",
        },
      ],
    },
    {
      title: "Language servers",
      options: [
        {
          kind: "number",
          key: "languages.serverIdleMinutes",
          label: "Stop an idle language server after",
          min: SERVER_IDLE_MINUTES.min,
          max: SERVER_IDLE_MINUTES.max,
          integer: true,
          unit: "min",
          hint: "Counted from when its last file closes. 0 keeps servers running until the project closes.",
        },
      ],
    },
  ],
};
