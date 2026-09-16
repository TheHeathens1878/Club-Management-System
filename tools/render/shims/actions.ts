/**
 * Stands in for every server-action module a fixture drags in.
 *
 * A client component that lives on a real screen imports its actions from a
 * `"use server"` file next door — `import { syncBlock } from "../actions"`.
 * Follow that import in a browser bundle and you pull in the Supabase server
 * client, `next/headers`, service-role keys and the rest of the server half of
 * the app, none of which a screenshot needs. The bundler redirects every
 * specifier ending in "/actions", "/actions.ts" or "-actions" here instead.
 *
 * Every name asked of this module answers with `async () => ({})`: the empty
 * object is what an action result of the `{ error?, notice? }` shape looks
 * like when nothing happened, so `useActionState` keeps its initial state and
 * the component renders its resting appearance.
 *
 * The names are not known in advance — the point is that ANY import succeeds —
 * so the exported object inherits from a Proxy. esbuild's interop for a
 * CommonJS module copies own properties onto an object whose PROTOTYPE is this
 * module's prototype, so the trap below is what answers `ns.syncBlock`. An
 * exported Proxy on its own would not survive that copy (it has no own keys).
 *
 * KNOWN LIMITATION, and the reason the README says pending states are not
 * covered: the returned promise resolves on the next tick, so
 * `useFormStatus().pending` and `useActionState`'s `pending` flag are
 * effectively always false. Spinners, "Saving…" labels and disabled-while-busy
 * buttons cannot be photographed by this harness. Give the component a prop
 * for the state you want to see, or screenshot it by hand.
 */

const anyAction = new Proxy(
  {},
  {
    get(_target, property) {
      // Symbols (Symbol.toStringTag, and `then` when something awaits the
      // namespace) must stay undefined or the module looks like a thenable.
      if (typeof property !== "string" || property === "then") return undefined;
      return async () => ({});
    },
  },
);

const namespace: Record<string, unknown> = Object.create(anyAction);
// Own property, so the bundler's interop treats this as an ES module and does
// not bury the exports under `default`.
namespace.__esModule = true;

// CommonJS on purpose, and with no `import`/`export` anywhere in the file: it
// is what lets the bundler hand the importer an object with a live prototype
// instead of a snapshot of its keys. Adding an `export {}` here would flip the
// file to ES module and `module` would be undefined at run time.
module.exports = namespace;
