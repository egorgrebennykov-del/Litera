import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import App from "./App.jsx";
import SearchCacheProvider from "./context/SearchCacheProvider";
import LanguageProvider from "./context/LanguageProvider";
import { ConfirmProvider } from "./context/ConfirmContext";
import "./utils/validationTooltip";

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <LanguageProvider>
      <SearchCacheProvider>
        <ConfirmProvider>
          <App />
        </ConfirmProvider>
      </SearchCacheProvider>
    </LanguageProvider>
  </BrowserRouter>,
);
