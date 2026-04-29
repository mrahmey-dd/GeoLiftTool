import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import GeoLiftApp from "./GeoLiftApp.jsx";

const root = createRoot(document.getElementById("root"));

root.render(
  <StrictMode>
    <GeoLiftApp />
  </StrictMode>
);
