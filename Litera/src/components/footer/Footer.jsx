import { Link } from "react-router";
import { isLoggedIn } from "../../../utils/auth";
import { useLanguage } from "../../context/languageContext";

export default function Footer() {
  const { t } = useLanguage();
  const accountPath = isLoggedIn() ? "/profile" : "/login";
  const accountLabel = isLoggedIn() ? t("nav.profile") : t("nav.login");

  const navigationLinks = [
    { to: "/", label: t("nav.home") },
    { to: "/featured", label: t("nav.bookPicks") },
    { to: "/discount", label: t("nav.discount") },
    { to: "/new", label: t("nav.newBooks") },
    { to: "/testimonial", label: t("nav.testimonial") },
    { to: "/contacts", label: t("nav.contacts") },
  ];

  return (
    <footer className="footer">
      <div className="footer__container container">
        <Link to="/" className="footer__brand" aria-label="Litera home">
          <img
            src="/assets/img/logo-dark.png"
            alt="Litera"
            className="footer__logo-image"
          />
        </Link>
        <nav className="footer__nav" aria-label="Footer navigation">
          <ul className="footer__links">
            {navigationLinks.map(({ to, label }) => (
              <li key={to}>
                <Link to={to} className="footer__link">
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="footer__actions">
          <Link to="/cart" className="footer__action">
            <i className="ri-shopping-basket-2-line" aria-hidden="true" />
            {t("nav.cart")}
          </Link>
          <Link to={accountPath} className="footer__action">
            <i className="ri-user-line" aria-hidden="true" />
            {accountLabel}
          </Link>
        </div>
      </div>
      <div className="footer__bottom container">
        <span className="footer__copy">
          © {new Date().getFullYear()} Litera
        </span>
        <span className="footer__tagline">{t("footer.tagline")}</span>
      </div>
    </footer>
  );
}
