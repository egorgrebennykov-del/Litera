import { useState, useEffect } from "react";
import { Link } from "react-router";
import "./SmallAnnouncements.css";

const DISMISSED_KEY = "litera_dismissed_announcements";

export default function SmallAnnouncements({ items = [] }) {
  const [dismissedIds, setDismissedIds] = useState(() => {
    try {
      const saved = localStorage.getItem(DISMISSED_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const handleDismiss = (id) => {
    const updated = [...dismissedIds, id];
    setDismissedIds(updated);
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(updated));
    } catch {
      // ignore
    }
  };

  const visibleItems = items.filter(
    (item) => item && item.type === "small" && !dismissedIds.includes(item.id)
  );

  if (visibleItems.length === 0) return null;

  return (
    <div className="litera-small-announcements-stack">
      {visibleItems.map((item) => {
        const hasLink = Boolean(item.linkUrl?.trim());
        const isExternal = hasLink && (item.linkUrl.startsWith("http://") || item.linkUrl.startsWith("https://"));

        return (
          <div key={item.id} className="litera-small-announcement-banner">
            <div className="litera-small-announcement-icon">
              <i className="ri-megaphone-fill" />
            </div>

            <div className="litera-small-announcement-content">
              <span className="litera-small-announcement-text">{item.text}</span>

              {hasLink && (
                isExternal ? (
                  <a
                    href={item.linkUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="litera-small-announcement-link"
                  >
                    Подробнее <i className="ri-arrow-right-line" />
                  </a>
                ) : (
                  <Link to={item.linkUrl} className="litera-small-announcement-link">
                    Подробнее <i className="ri-arrow-right-line" />
                  </Link>
                )
              )}
            </div>

            <button
              type="button"
              className="litera-small-announcement-close"
              onClick={() => handleDismiss(item.id)}
              aria-label="Закрыть объявление"
              title="Закрыть"
            >
              <i className="ri-close-line" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
