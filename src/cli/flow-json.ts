import type { Card, Comment } from "../domain/models";

export type FlowBreadcrumb = {
  action: string;
  cmd: string;
  description: string;
};

/**
 * One line, no indentation: the envelope is read by programs and agents, and pretty-printing
 * roughly doubled its size for no reader.
 */
export const flowJson = (
  data: unknown,
  summary: string,
  breadcrumbs: ReadonlyArray<FlowBreadcrumb> = [],
): string =>
  JSON.stringify({
    ok: true,
    data,
    summary,
    ...(breadcrumbs.length > 0 ? { breadcrumbs } : {}),
  });

export interface LeanCard {
  number: number;
  title: string;
  column: string | null;
  assignees: ReadonlyArray<string>;
  steps?: { done: number; total: number };
  closed?: true;
}

/**
 * What a card list needs to answer "which card": the description (plain and HTML) made a
 * two-card list tens of thousands of characters. `--full` returns the untouched cards.
 */
export const leanCard = (card: Card): LeanCard => {
  const steps = card.steps ?? [];
  return {
    number: card.number,
    title: card.title,
    column: card.column?.name ?? null,
    assignees: (card.assignees ?? []).map((assignee) => assignee.name),
    ...(steps.length > 0
      ? { steps: { done: steps.filter((step) => step.completed).length, total: steps.length } }
      : {}),
    ...(card.closed ? { closed: true as const } : {}),
  };
};

export const cardsJsonData = (cards: ReadonlyArray<Card>, full: boolean): unknown =>
  full ? cards : cards.map(leanCard);

/** The card as a reader needs it: one description, not the same text again as HTML. */
export const cardDetailJsonData = (
  result: { card: Card; comments: ReadonlyArray<Comment>; toggled: unknown },
  full: boolean,
): unknown => {
  if (full) return result;
  const { descriptionHtml, ...card } = result.card;
  return {
    ...result,
    card: card.description ? card : { ...card, ...(descriptionHtml ? { descriptionHtml } : {}) },
  };
};
