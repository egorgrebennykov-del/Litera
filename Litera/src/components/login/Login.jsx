import { useState, useRef, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { login } from "../../../utils/auth";
import { useLanguage } from "../../context/languageContext";
import {
  showValidationTooltip,
  hideValidationTooltip,
} from "../../utils/validationTooltip";

export default function Login({ onSignUp, onClose }) {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const emailRef = useRef(null);
  const passwordRef = useRef(null);

  useEffect(() => {
    return () => {
      hideValidationTooltip();
    };
  }, []);

  const handlePasswordCopy = (e) => {
    const input = e.currentTarget;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const textToCopy =
      start !== null && end !== null && start !== end
        ? password.substring(start, end)
        : password;

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

  const handlePasswordCut = (e) => {
    const input = e.currentTarget;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const textToCopy =
      start !== null && end !== null && start !== end
        ? password.substring(start, end)
        : password;

    if (textToCopy) {
      if (e.clipboardData) {
        e.clipboardData.setData("text/plain", textToCopy);
        e.preventDefault();
      }
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(textToCopy).catch(() => {});
      }
      if (start !== null && end !== null && start !== end) {
        setPassword(password.slice(0, start) + password.slice(end));
      } else {
        setPassword("");
      }
    }
  };

  const handlePasswordKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === "c" || e.key === "C")) {
      const input = e.currentTarget;
      const start = input.selectionStart;
      const end = input.selectionEnd;
      const textToCopy =
        start !== null && end !== null && start !== end
          ? password.substring(start, end)
          : password;
      if (textToCopy && navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(textToCopy).catch(() => {});
      }
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");

    const trimmedIdentifier = email.trim();
    if (!trimmedIdentifier) {
      const msg =
        language === "ru" ? "Заполните это поле." : "Please fill out this field.";
      showValidationTooltip(emailRef.current, msg);
      emailRef.current?.focus();
      return;
    }

    if (!password) {
      const msg =
        language === "ru" ? "Заполните это поле." : "Please fill out this field.";
      showValidationTooltip(passwordRef.current, msg);
      passwordRef.current?.focus();
      return;
    }

    setSubmitting(true);
    try {
      await login(trimmedIdentifier, password);
      hideValidationTooltip();
      const destination = params.get("redirect");
      navigate(
        destination?.startsWith("/") && !destination.startsWith("//")
          ? destination
          : "/",
      );
    } catch (err) {
      const isRu = language === "ru";
      let displayMsg = err.message;
      if (err.message === "Invalid email or password") {
        displayMsg = isRu
          ? "Неверный логин или пароль"
          : "Invalid email/login or password";
      }
      setError(displayMsg);
      showValidationTooltip(emailRef.current, displayMsg);
      emailRef.current?.focus();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login grid show-login" id="login-content">
      <form className="login__form grid" onSubmit={handleSubmit} noValidate>
        <button
          type="button"
          className="auth-close"
          id="login-close"
          aria-label="Close login"
          onClick={() => {
            hideValidationTooltip();
            onClose();
          }}
        >
          ×
        </button>
        <h3 className="login__title">{t("auth.loginTitle")}</h3>
        <div className="login__group grid">
          <div>
            <label htmlFor="login-email" className="login__label">
              {t("auth.email")}
            </label>
            <input
              type="text"
              placeholder={t("auth.emailPlaceholder")}
              id="login-email"
              className="login__input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
              ref={emailRef}
            />
          </div>
          <div>
            <label htmlFor="login-pass" className="login__label">
              {t("auth.password")}
            </label>
            <div className="auth__password-wrap">
              <input
                type={showPassword ? "text" : "password"}
                placeholder={t("auth.passwordPlaceholder")}
                id="login-pass"
                className="login__input auth__password-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onCopy={handlePasswordCopy}
                onCut={handlePasswordCut}
                onKeyDown={handlePasswordKeyDown}
                autoComplete="current-password"
                required
                ref={passwordRef}
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
        </div>
        {error && (
          <p role="alert" style={{ color: "hsl(0, 70%, 50%)" }}>
            {error}
          </p>
        )}
        <div>
          <span className="login__signup">
            {t("auth.noAccount")}{" "}
            <a
              href="#"
              onClick={(event) => {
                event.preventDefault();
                hideValidationTooltip();
                onSignUp();
              }}
            >
              {t("auth.signUpBtn")}
            </a>
          </span>
          <a href="#" className="login__forgot">
            {t("auth.forgotPassword")}
          </a>
          <button
            type="submit"
            className="login__button button"
            disabled={submitting}
          >
            {t("auth.loginBtn")}
          </button>
        </div>
      </form>
    </div>
  );
}
