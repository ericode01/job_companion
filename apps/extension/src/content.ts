import { send, type ApplyPacket, type FormQuestion, type QuestionAnswer } from "./messages";
import { findFormRoot } from "./engine/collect";
import { atsOf, isConfirmationPage } from "./engine/detect";
import { sleep } from "./engine/dom";
import { Panel } from "./engine/panel";
import { finalAnswers, runFill, type Item } from "./engine/runner";

const api = {
  packet: (applicationId: number) => send<ApplyPacket>({ type: "packet", applicationId }),
  answers: (applicationId: number, questions: FormQuestion[]) => send<{ answers: QuestionAnswer[]; inboxAdded: number }>({ type: "answers", applicationId, questions }),
};

async function waitForForm(timeoutMs = 15000): Promise<Element | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const root = findFormRoot(document);
    if (root) return root;
    await sleep(500);
  }
  return null;
}

async function main() {
  if (!atsOf(location.hostname)) return;
  // Embedded boards render in an iframe; only act in the frame that holds the form.
  const root = await waitForForm();
  if (!root) {
    if (isConfirmationPage(document)) await reportIfTracked();
    return;
  }

  const panel = new Panel();
  let applicationId = await send<number | null>({ type: "get-application" }).catch(() => null);
  if (applicationId === null) {
    panel.showPill("Prefill with Job Companion", async () => {
      panel.showMessage("Job Companion", "Looking up this job…");
      try {
        applicationId = await send<number | null>({ type: "match", url: location.href });
        if (applicationId === null) {
          panel.showMessage("Job Companion", "This job isn't in Job Companion yet. Ask your admin to add the company, then reload.", "error");
          return;
        }
        await start(panel, root, applicationId);
      } catch (err) {
        panel.showMessage("Job Companion", err instanceof Error ? err.message : String(err), "error");
      }
    });
    return;
  }
  await start(panel, root, applicationId);
}

async function start(panel: Panel, root: Element, applicationId: number) {
  let items: Item[] = [];
  let title = "Job Companion";
  let subtitle = "Filling the application…";
  let banner: { text: string; tone: "info" | "success" | "warn" } | undefined = { text: "Filling the form. This can take a few seconds.", tone: "info" };
  let submitted = false;

  const actions = {
    refill: () => void fill(),
    saveAnswer: async (item: Item, answer: string, scope: "global" | "job") => {
      await send({ type: "save-answer", applicationId, question: item.field.label, answer, category: item.answer?.category ?? "custom", scope });
    },
  };
  const render = () => panel.render(title, subtitle, items, actions, banner);
  panel.onRerender(render);

  async function fill() {
    banner = { text: "Filling the form. This can take a few seconds.", tone: "info" };
    render();
    try {
      const result = await runFill(root, applicationId, api, (partial) => {
        items = partial;
        render();
      });
      items = result.items;
      title = result.packet.job.company;
      subtitle = result.packet.job.title;
      const needs = items.filter((i) => i.status === "needs_user" || i.status === "failed").length;
      const letterPending = result.packet.coverLetterChoice === "yes" && !result.packet.coverLetter;
      banner = letterPending
        ? { text: "Your cover letter is still being written. Use Fill again in a minute.", tone: "warn" }
        : needs
          ? { text: `${needs} ${needs === 1 ? "field needs" : "fields need"} your input.${result.inboxAdded ? " New questions were added to your Answers inbox." : ""}`, tone: "warn" }
          : { text: "Everything is filled. Review it, then submit on the page.", tone: "success" };
      render();
    } catch (err) {
      panel.showMessage("Job Companion", err instanceof Error ? err.message : String(err), "error");
    }
  }

  await fill();

  // Watch for the job board's confirmation after YOU submit. The extension never submits.
  const check = async () => {
    if (submitted || !isConfirmationPage(document)) return;
    submitted = true;
    try {
      await send({ type: "submitted", applicationId, answers: finalAnswers(items) });
      banner = { text: "Submitted. Marked as Applied in your pipeline.", tone: "success" };
    } catch (err) {
      banner = { text: `Submitted, but couldn't update the app: ${err instanceof Error ? err.message : String(err)}`, tone: "warn" };
    }
    render();
  };
  new MutationObserver(() => void check()).observe(document.body, { childList: true, subtree: true });
  setInterval(() => void check(), 2000);
}

/** Lever shows confirmation on a new page (/thanks) with no form. */
async function reportIfTracked() {
  const applicationId = await send<number | null>({ type: "get-application" }).catch(() => null);
  if (applicationId !== null) await send({ type: "submitted", applicationId, answers: [] }).catch(() => {});
}

void main();
