// Tiny window-event bus for opening the AI composer from modules that must
// not import ai-composer.tsx directly. The concrete case: artifact-walker
// renders ActionBar nodes with 'openComposer' actions, but ai-composer
// imports the walker to render previews — a direct hook import would be a
// module cycle. AiComposerScope listens for this event and calls open().

export type ComposerOpenRequest = {
  prompt?: string;
  objectKey?: string;
};

export const COMPOSER_OPEN_EVENT = 'northbeam:open-composer';

export function requestComposerOpen(detail: ComposerOpenRequest): void {
  window.dispatchEvent(new CustomEvent<ComposerOpenRequest>(COMPOSER_OPEN_EVENT, { detail }));
}
