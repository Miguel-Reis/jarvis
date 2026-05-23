/**
 * DOM test setup using happy-dom.
 * Loaded via bunfig.toml [test] preload for UI tests.
 */
import { Window } from "happy-dom";

const window = new Window({ url: "http://localhost:3142" });

// Assign globals that @testing-library/react needs
(globalThis as any).document = window.document;
(globalThis as any).window = window;
(globalThis as any).navigator = window.navigator;
(globalThis as any).HTMLElement = window.HTMLElement;
(globalThis as any).Element = window.Element;
(globalThis as any).Node = window.Node;
(globalThis as any).Event = window.Event;
(globalThis as any).CustomEvent = window.CustomEvent;
(globalThis as any).MutationObserver = window.MutationObserver;
(globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(cb, 16);
(globalThis as any).cancelAnimationFrame = clearTimeout;
(globalThis as any).crypto = window.crypto;
