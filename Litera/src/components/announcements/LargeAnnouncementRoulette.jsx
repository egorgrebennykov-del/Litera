import { useState, useEffect, useRef } from "react";
import "./LargeAnnouncementRoulette.css";

export default function LargeAnnouncementRoulette({ items = [] }) {
  const posters = items.filter((item) => item && item.type === "large" && item.imageUrl);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const timerRef = useRef(null);

  const count = posters.length;

  useEffect(() => {
    if (count <= 1 || isPaused) return;

    timerRef.current = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % count);
    }, 5000);

    return () => clearInterval(timerRef.current);
  }, [count, isPaused]);

  if (count === 0) return null;

  const handlePrev = (e) => {
    e?.stopPropagation();
    setCurrentIndex((prev) => (prev - 1 + count) % count);
  };

  const handleNext = (e) => {
    e?.stopPropagation();
    setCurrentIndex((prev) => (prev + 1) % count);
  };

  const currentPoster = posters[currentIndex];
  const hasLink = Boolean(currentPoster?.linkUrl?.trim());
  const isExternal = hasLink && (currentPoster.linkUrl.startsWith("http://") || currentPoster.linkUrl.startsWith("https://"));

  return (
    <div
      className="litera-poster-roulette-container"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      <div className="litera-poster-slide-wrapper">
        {hasLink ? (
          <a
            href={currentPoster.linkUrl}
            target={isExternal ? "_blank" : "_self"}
            rel={isExternal ? "noopener noreferrer" : undefined}
            className="litera-poster-link"
          >
            <img
              src={currentPoster.imageUrl}
              alt="Рекламный плакат"
              className="litera-poster-image"
              loading="eager"
            />
          </a>
        ) : (
          <div className="litera-poster-link">
            <img
              src={currentPoster.imageUrl}
              alt="Рекламный плакат"
              className="litera-poster-image"
              loading="eager"
            />
          </div>
        )}

        {/* Controls if multiple */}
        {count > 1 && (
          <>
            <button
              type="button"
              className="litera-poster-btn litera-poster-btn--prev"
              onClick={handlePrev}
              aria-label="Предыдущий плакат"
            >
              <i className="ri-arrow-left-s-line" />
            </button>
            <button
              type="button"
              className="litera-poster-btn litera-poster-btn--next"
              onClick={handleNext}
              aria-label="Следующий плакат"
            >
              <i className="ri-arrow-right-s-line" />
            </button>

            {/* Dots */}
            <div className="litera-poster-dots">
              {posters.map((_, idx) => (
                <button
                  key={idx}
                  type="button"
                  className={`litera-poster-dot ${idx === currentIndex ? "litera-poster-dot--active" : ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setCurrentIndex(idx);
                  }}
                  aria-label={`Плакат ${idx + 1}`}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
