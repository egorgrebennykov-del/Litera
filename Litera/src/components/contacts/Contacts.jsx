import { useState } from "react";
import { useLanguage } from "../../context/languageContext";
import "./Contacts.css";

export default function Contacts() {
  const { language, t } = useLanguage();
  const [copiedKey, setCopiedKey] = useState(null);

  const handleCopy = (key, text) => {
    if (!navigator?.clipboard?.writeText) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key);
      setTimeout(() => {
        setCopiedKey((prev) => (prev === key ? null : prev));
      }, 2000);
    });
  };

  const handleSendEmail = (e) => {
    try {
      window.location.href = `mailto:${email}`;
    } catch {
      // fallback
    }
    handleCopy("email-btn", email);
  };

  const phone = "+359879485078";
  const email = "egor.grebennykov@gmail.com";
  const addressText =
    language === "ru"
      ? "Болгария, Несебр, улица Парва 8240"
      : "Parva St, 8240 Nesebar, Bulgaria";
  const mapsUrl = `https://maps.google.com/?q=${encodeURIComponent("Nesebar Parva street 8240 Bulgaria")}`;

  const socials = [
    {
      name: "Instagram",
      handle: "@egorgeb",
      url: "https://www.instagram.com/egorgeb/",
      icon: "ri-instagram-line",
      colorClass: "contacts__social--instagram",
    },
    {
      name: "Telegram",
      handle: "@egorgeb",
      url: "https://t.me/egorgeb",
      icon: "ri-telegram-fill",
      colorClass: "contacts__social--telegram",
    },
    {
      name: "Facebook",
      handle: language === "ru" ? "Егор Гребенников" : "Yegor Grebennykov",
      url: "https://www.facebook.com/egor.grebennykov/",
      icon: "ri-facebook-circle-fill",
      colorClass: "contacts__social--facebook",
    },
  ];

  return (
    <section className="contacts section container" id="contacts">
      <div className="contacts__header">
        <h1 className="section__title">{t("contacts.title")}</h1>
        <p className="contacts__subtitle">{t("contacts.subtitle")}</p>
      </div>

      {/* Main Founder Card */}
      <div className="contacts__hero-card">
        <div className="contacts__hero-grid">
          <div className="contacts__photo-wrap">
            <div className="contacts__photo-frame">
              <img
                src="/assets/img/director.png"
                alt={language === "ru" ? "Егор Гребенников" : "Yegor Grebennykov"}
                className="contacts__photo"
                loading="eager"
              />
            </div>
            <div className="contacts__photo-glow" aria-hidden="true" />
          </div>

          <div className="contacts__hero-info">
            <div className="contacts__hero-badge">
              <i className="ri-award-fill" />
              <span>{t("contacts.role")}</span>
            </div>

            <h2 className="contacts__hero-name">
              {language === "ru" ? "Егор Гребенников" : "Yegor Grebennykov"}
            </h2>

            <div className="contacts__hero-tags">
              <span className="contacts__tag contacts__tag--gold">
                <i className="ri-vip-crown-fill" /> VIP
              </span>
              <span className="contacts__tag contacts__tag--dev">
                <i className="ri-code-box-line" />
                {language === "ru" ? "Девелопер" : "Developer"}
              </span>
              <span className="contacts__tag contacts__tag--litera">
                <i className="ri-book-read-line" /> Litera
              </span>
            </div>

            <div className="contacts__story">
              <p className="contacts__story-lead">{t("contacts.aboutP1")}</p>
              <p>{t("contacts.aboutP2")}</p>
              <p>{t("contacts.aboutP3")}</p>
            </div>

            <div className="contacts__quick-actions">
              <a
                href="https://t.me/egorgeb"
                target="_blank"
                rel="noopener noreferrer"
                className="button contacts__action-btn contacts__action-btn--tg"
              >
                <i className="ri-telegram-fill" />
                <span>{language === "ru" ? "Написать в Telegram" : "Telegram Message"}</span>
              </a>

              <a
                href={`mailto:${email}`}
                onClick={handleSendEmail}
                className="button button--ghost contacts__action-btn"
              >
                <i className={copiedKey === "email-btn" ? "ri-check-line" : "ri-mail-send-line"} />
                <span>
                  {copiedKey === "email-btn"
                    ? (language === "ru" ? "Email скопирован!" : "Email copied!")
                    : (language === "ru" ? "Написать на Email" : "Send Email")}
                </span>
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Contact Channels Grid */}
      <div className="contacts__section-block">
        <h3 className="contacts__section-title">
          <i className="ri-contacts-line" />
          {t("contacts.direct")}
        </h3>

        <div className="contacts__cards-grid">
          {/* Phone Card */}
          <div className="contacts__card">
            <div className="contacts__card-icon contacts__card-icon--phone">
              <i className="ri-phone-fill" />
            </div>
            <div className="contacts__card-content">
              <span className="contacts__card-label">{t("contacts.phone")}</span>
              <a href={`tel:${phone}`} className="contacts__card-value">
                {phone}
              </a>
              <span className="contacts__card-desc">
                {language === "ru"
                  ? "Звонки и сообщения WhatsApp / Viber"
                  : "Calls & instant messaging"}
              </span>
            </div>
            <button
              type="button"
              className="contacts__copy-btn"
              onClick={() => handleCopy("phone", phone)}
              title={copiedKey === "phone" ? t("contacts.copied") : t("contacts.copy")}
            >
              <i className={copiedKey === "phone" ? "ri-check-line" : "ri-file-copy-line"} />
              <span>{copiedKey === "phone" ? t("contacts.copied") : t("contacts.copy")}</span>
            </button>
          </div>

          {/* Email Card */}
          <div className="contacts__card">
            <div className="contacts__card-icon contacts__card-icon--email">
              <i className="ri-mail-fill" />
            </div>
            <div className="contacts__card-content">
              <span className="contacts__card-label">{t("contacts.email")}</span>
              <a href={`mailto:${email}`} className="contacts__card-value">
                {email}
              </a>
              <span className="contacts__card-desc">
                {language === "ru"
                  ? "Вопросы сотрудничества и партнерства"
                  : "Partnerships & general inquiries"}
              </span>
            </div>
            <button
              type="button"
              className="contacts__copy-btn"
              onClick={() => handleCopy("email", email)}
              title={copiedKey === "email" ? t("contacts.copied") : t("contacts.copy")}
            >
              <i className={copiedKey === "email" ? "ri-check-line" : "ri-file-copy-line"} />
              <span>{copiedKey === "email" ? t("contacts.copied") : t("contacts.copy")}</span>
            </button>
          </div>

          {/* Address Card */}
          <div className="contacts__card">
            <div className="contacts__card-icon contacts__card-icon--address">
              <i className="ri-map-pin-2-fill" />
            </div>
            <div className="contacts__card-content">
              <span className="contacts__card-label">{t("contacts.address")}</span>
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="contacts__card-value contacts__card-value--address"
              >
                {addressText}
              </a>
              <span className="contacts__card-desc">
                {language === "ru"
                  ? "Отправка заказов и корреспонденции"
                  : "Orders shipping & correspondence"}
              </span>
            </div>
            <button
              type="button"
              className="contacts__copy-btn"
              onClick={() => handleCopy("address", addressText)}
              title={copiedKey === "address" ? t("contacts.copied") : t("contacts.copy")}
            >
              <i className={copiedKey === "address" ? "ri-check-line" : "ri-file-copy-line"} />
              <span>{copiedKey === "address" ? t("contacts.copied") : t("contacts.copy")}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Social Networks Section */}
      <div className="contacts__section-block">
        <h3 className="contacts__section-title">
          <i className="ri-share-line" />
          {t("contacts.socials")}
        </h3>

        <div className="contacts__socials-grid">
          {socials.map((item) => (
            <a
              key={item.name}
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`contacts__social-card ${item.colorClass}`}
            >
              <div className="contacts__social-icon">
                <i className={item.icon} />
              </div>
              <div className="contacts__social-info">
                <strong className="contacts__social-name">{item.name}</strong>
                <span className="contacts__social-handle">{item.handle}</span>
              </div>
              <div className="contacts__social-arrow">
                <i className="ri-arrow-right-up-line" />
              </div>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
