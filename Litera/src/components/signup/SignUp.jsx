import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { register } from "../../../utils/auth";
import { useLanguage } from "../../context/languageContext";
import PhoneInput from "../common/PhoneInput";
import { countries } from "../checkout/countryPhoneCodes";
import {
  showValidationTooltip,
  hideValidationTooltip,
} from "../../utils/validationTooltip";

export default function SignUp({ onLogin, onClose }) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    repeat: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showRepeat, setShowRepeat] = useState(false);
  const [phone, setPhone] = useState("");
  const [countryIso, setCountryIso] = useState("MD");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    return () => {
      hideValidationTooltip();
    };
  }, []);

  const handlePasswordCopy = (e, fieldName) => {
    const input = e.currentTarget;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const val = form[fieldName] || "";
    const textToCopy =
      start !== null && end !== null && start !== end
        ? val.substring(start, end)
        : val;

    if (textToCopy) {
      if (e.clipboardData) {
        e.clipboardData.setData("text/plain", textToCopy);
        e.preventDefault();
      }
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(textToCopy).catch(() => {});
      }
    }
  };

  const handlePasswordCut = (e, fieldName) => {
    const input = e.currentTarget;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const val = form[fieldName] || "";
    const textToCopy =
      start !== null && end !== null && start !== end
        ? val.substring(start, end)
        : val;

    if (textToCopy) {
      if (e.clipboardData) {
        e.clipboardData.setData("text/plain", textToCopy);
        e.preventDefault();
      }
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(textToCopy).catch(() => {});
      }
      if (start !== null && end !== null && start !== end) {
        setForm((f) => ({
          ...f,
          [fieldName]: val.slice(0, start) + val.slice(end),
        }));
      } else {
        setForm((f) => ({ ...f, [fieldName]: "" }));
      }
    }
  };

  const handlePasswordKeyDown = (e, fieldName) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === "c" || e.key === "C")) {
      const input = e.currentTarget;
      const start = input.selectionStart;
      const end = input.selectionEnd;
      const val = form[fieldName] || "";
      const textToCopy =
        start !== null && end !== null && start !== end
          ? val.substring(start, end)
          : val;
      if (textToCopy && navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(textToCopy).catch(() => {});
      }
    }
  };

  const field = (name) => ({
    value: form[name],
    onChange: (e) => setForm((f) => ({ ...f, [name]: e.target.value })),
  });

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    if (!phone.trim()) {
      const msg = t("checkout.phoneRequired");
      setError(msg);
      showValidationTooltip(document.getElementById("signup-phone"), msg);
      return;
    }
    if (form.password !== form.repeat) {
      const msg = t("auth.passwordsMismatch");
      setError(msg);
      showValidationTooltip(document.getElementById("signup-repeat") || document.getElementById("signup-password"), msg);
      return;
    }
    setSubmitting(true);
    try {
      const selectedCountry =
        countries.find((c) => c.iso2 === countryIso) || countries[0];
      const fullPhone = `${selectedCountry.dialCode} ${phone.trim()}`;
      await register({
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        password: form.password,
        phone: fullPhone,
      });
      hideValidationTooltip();
      const destination = params.get("redirect");
      navigate(
        destination?.startsWith("/") && !destination.startsWith("//")
          ? destination
          : "/",
      );
    } catch (err) {
      setError(err.message);
      showValidationTooltip(document.getElementById("signup-email"), err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login grid show-login" id="signup-content">
      <form className="login__form grid" onSubmit={handleSubmit}>
        <button
          type="button"
          className="auth-close"
          id="signup-close"
          aria-label="Close sign up"
          onClick={() => {
            hideValidationTooltip();
            onClose();
          }}
        >
          ×
        </button>
        <h3 className="login__title">{t("auth.signUpTitle")}</h3>
        <div className="login__group grid">
          <div>
            <label htmlFor="signup-first-name" className="login__label">
              {t("auth.firstName")}
            </label>
            <input
              type="text"
              placeholder={t("auth.firstNamePlaceholder")}
              id="signup-first-name"
              className="login__input"
              autoComplete="given-name"
              maxLength={100}
              required
              {...field("firstName")}
            />
          </div>
          <div>
            <label htmlFor="signup-last-name" className="login__label">
              {t("auth.lastName")}
            </label>
            <input
              type="text"
              placeholder={t("auth.lastNamePlaceholder")}
              id="signup-last-name"
              className="login__input"
              autoComplete="family-name"
              maxLength={100}
              required
              {...field("lastName")}
            />
          </div>
          <div>
            <label htmlFor="signup-email" className="login__label">
              {t("auth.email")}
            </label>
            <input
              type="email"
              placeholder={t("auth.emailPlaceholder")}
              id="signup-email"
              className="login__input"
              autoComplete="email"
              required
              {...field("email")}
            />
          </div>
          <div>
            <label htmlFor="signup-phone" className="login__label">
              {t("checkout.phone")} <span className="checkout__required">*</span>
            </label>
            <PhoneInput
              id="signup-phone"
              phone={phone}
              countryIso={countryIso}
              onPhoneChange={setPhone}
              onCountryChange={setCountryIso}
              required
            />
          </div>
          <div>
            <label htmlFor="signup-password" className="login__label">
              {t("auth.password")}
            </label>
            <div className="auth__password-wrap">
              <input
                type={showPassword ? "text" : "password"}
                placeholder={t("auth.passwordPlaceholder")}
                id="signup-password"
                className="login__input auth__password-input"
                autoComplete="new-password"
                minLength={8}
                maxLength={72}
                required
                onCopy={(e) => handlePasswordCopy(e, "password")}
                onCut={(e) => handlePasswordCut(e, "password")}
                onKeyDown={(e) => handlePasswordKeyDown(e, "password")}
                {...field("password")}
              />
              <button
                type="button"
                className="auth__password-toggle"
                onClick={() => setShowPassword((prev) => !prev)}
                title={showPassword ? t("auth.hidePassword") : t("auth.showPassword")}
                aria-label={showPassword ? t("auth.hidePassword") : t("auth.showPassword")}
                tabIndex={-1}
              >
                <i className={showPassword ? "ri-eye-off-line" : "ri-eye-line"} />
              </button>
            </div>
          </div>
          <div>
            <label htmlFor="signup-repeat-password" className="login__label">
              {t("auth.repeatPassword")}
            </label>
            <div className="auth__password-wrap">
              <input
                type={showRepeat ? "text" : "password"}
                placeholder={t("auth.repeatPasswordPlaceholder")}
                id="signup-repeat-password"
                className="login__input auth__password-input"
                autoComplete="new-password"
                required
                onCopy={(e) => handlePasswordCopy(e, "repeat")}
                onCut={(e) => handlePasswordCut(e, "repeat")}
                onKeyDown={(e) => handlePasswordKeyDown(e, "repeat")}
                {...field("repeat")}
              />
              <button
                type="button"
                className="auth__password-toggle"
                onClick={() => setShowRepeat((prev) => !prev)}
                title={showRepeat ? t("auth.hidePassword") : t("auth.showPassword")}
                aria-label={showRepeat ? t("auth.hidePassword") : t("auth.showPassword")}
                tabIndex={-1}
              >
                <i className={showRepeat ? "ri-eye-off-line" : "ri-eye-line"} />
              </button>
            </div>
          </div>
        </div>
        {error && (
          <p role="alert" style={{ color: "hsl(0, 70%, 50%)" }}>
            {error}
          </p>
        )}
        <div>
          <span className="login__signup">
            {t("auth.haveAccount")}{" "}
            <a
              href="#"
              onClick={(event) => {
                event.preventDefault();
                hideValidationTooltip();
                onLogin();
              }}
            >
              {t("auth.loginBtn")}
            </a>
          </span>
          <button
            type="submit"
            className="login__button button"
            disabled={submitting}
          >
            {t("auth.signUpBtn")}
          </button>
        </div>
      </form>
    </div>
  );
}
