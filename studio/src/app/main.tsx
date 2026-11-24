import "../styles/fonts/fonts.css";
import "../styles/tokens.css";
import "../styles/base.css";
import "../instrument/instrument.css";
import "./app.css";

import { createRoot } from "react-dom/client";
import { App } from "./App";
import { applySettings, getSettings } from "./settings";
import { register } from "./update";

applySettings(getSettings());
register();
const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
