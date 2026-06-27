// Provider registry bootstrap.
// Importing these triggers self-registration via registry.js
import "./rssProvider.js";
import "./newsProvider.js";
import "./mockProvider.js";

// Future provider stubs (registered for extensibility proof; throw NotImplemented until implemented)
import "./crawl4aiProvider.js";
import "./xProvider.js";
import "./redditProvider.js";

// Re-export the registry API
export {
  registerProvider,
  getProvider,
  listProviders,
  collectCandidatesForQuery
} from "./registry.js";
