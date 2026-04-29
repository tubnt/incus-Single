import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import HttpBackend from "i18next-http-backend";
import { initReactI18next } from "react-i18next";

i18n
  .use(HttpBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: "en",
    supportedLngs: ["en", "zh"],
    ns: ["common"],
    defaultNS: "common",
    backend: {
      loadPath: "/locales/{{lng}}/{{ns}}.json",
    },
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
    },
    interpolation: {
      escapeValue: false,
    },
  });

const syncHtmlLang = (lng: string) => {
  if (typeof document !== "undefined") {
    const normalized = lng.startsWith("zh") ? "zh" : lng.split("-")[0] || "en";
    document.documentElement.setAttribute("lang", normalized);
  }
};

i18n.on("languageChanged", syncHtmlLang);
if (i18n.isInitialized && i18n.language) {
  syncHtmlLang(i18n.language);
} else {
  i18n.on("initialized", () => syncHtmlLang(i18n.language));
}

export default i18n;
