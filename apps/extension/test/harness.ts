/** Dev-only: exposes the form engine on window for testing against live job boards. Not shipped. */
import { classifyField } from "../src/engine/classify";
import { collectFields, findFormRoot } from "../src/engine/collect";
import { fillField, readComboboxOptions } from "../src/engine/fill";
import { Panel } from "../src/engine/panel";
import { runFill } from "../src/engine/runner";

(window as unknown as { __jd: unknown }).__jd = { classifyField, collectFields, findFormRoot, runFill, readComboboxOptions, fillField, Panel };
