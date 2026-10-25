import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import CarouselControls from "../carouselcontrols/CarouselControls";
import getHomepageBooks, { getCachedHomepageBooks } from "../../../utils/getHomepageBooks";
import BookImage from "../common/BookImage";
import decodeHtmlEntities from "../../../utils/decodeHtmlEntities";
import { useLanguage } from "../../context/languageContext";
import SmallAnnouncements from "../announcements/SmallAnnouncements";
import LargeAnnouncementRoulette from "../announcements/LargeAnnouncementRoulette";
import {
  fetchActiveAnnouncements,
  getCachedActiveAnnouncements,
} from "../../../utils/announcements";
import "./Home.css";

export default function Home() {
  const { t } = useLanguage();
  const location = useLocation();
  const [books, setBooks] = useState(() => getCachedHomepageBooks() ?? []);
  const [booksError, setBooksError] = useState(false);
  const [booksReady, setBooksReady] = useState(() => Boolean(getCachedHomepageBooks()));
  const [announcements, setAnnouncements] = useState(
    () => getCachedActiveAnnouncements() ?? [],
  );

  useEffect(() => {
    let cancelled = false;
    fetchActiveAnnouncements()
      .then((items) => {
        if (!cancelled && Array.isArray(items)) {
          setAnnouncements(items);
        }
      })
      .catch((err) => console.warn("Failed to fetch active announcements:", err));

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getHomepageBooks()
      .then((items) => !cancelled && setBooks(items))
      .catch(() => !cancelled && setBooksError(true))
      .finally(() => !cancelled && setBooksReady(true));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!booksReady || !location.state?.restoreHomeScroll) return;
    const savedPageScroll = Number(
      sessionStorage.getItem("kazbook-home-page-scroll"),
    );
    const savedCarouselScroll = Number(
      sessionStorage.getItem("kazbook-home-carousel-scroll"),
    );
    sessionStorage.removeItem("kazbook-home-page-scroll");
    sessionStorage.removeItem("kazbook-home-carousel-scroll");

    requestAnimationFrame(() => {
      if (Number.isFinite(savedPageScroll)) {
        window.scrollTo(0, savedPageScroll);
      }
      const carousel = document.querySelector(".home__swiper");
      if (carousel && Number.isFinite(savedCarouselScroll)) {
        carousel.scrollTo({ left: savedCarouselScroll, behavior: "instant" });
      }
    });
  }, [booksReady, location.state]);

  return (
    <section className="home section" id="home">
      {/* Top Small Announcements Stack */}
      <div className="container">
        <SmallAnnouncements items={announcements} />
      </div>

      {/* Large Announcement Poster / Roulette - Centered & Wide across the page */}
      <div className="container home__large-announcement-wrap">
        <LargeAnnouncementRoulette items={announcements} />
      </div>

      <div className="home__container container grid">
        <div className="home__data">
          <h1 className="home__title">{t("home.title")}</h1>
          <p className="home__description">{t("home.description")}</p>
          <Link to="/featured" className="button">
            {t("home.startShopping")}
          </Link>
        </div>
        <div className="home__images">
          <div className="carousel">
            <div className="home__swiper swiper">
              <div className="swiper-wrapper">
                {books.map((book, index) => (
                  <article
                    className="home__article swiper-slide"
                    key={book.url}
                  >
                    <Link
                      className="home__book-link"
                      to={`/book?url=${encodeURIComponent(book.url)}&q=${encodeURIComponent(book.title)}&source=home`}
                      state={{
                        book: {
                          title: book.title,
                          url: book.url,
                          image: book.image,
                          store: book.store,
                          price: book.price,
                          currency: book.currency,
                        },
                        query: book.title,
                        fromHome: true,
                      }}
                      onClick={() => {
                        sessionStorage.setItem(
                          "kazbook-home-page-scroll",
                          String(window.scrollY),
                        );
                        sessionStorage.setItem(
                          "kazbook-home-carousel-scroll",
                          String(
                            document.querySelector(".home__swiper")
                              ?.scrollLeft ?? 0,
                          ),
                        );
                      }}
                    >
                      <BookImage
                        src={book.image}
                        alt={book.title}
                        className="home__img"
                        loading={index < 4 ? "eager" : "lazy"}
                        decoding={index < 4 ? "auto" : "async"}
                        fetchPriority={index < 2 ? "high" : "auto"}
                      />
                      <span className="home__book-title">
                        {decodeHtmlEntities(book.title)}
                      </span>
                      {book.publisher && (
                        <span className="home__book-publisher">
                          {book.publisher}
                        </span>
                      )}
                    </Link>
                  </article>
                ))}
              </div>
            </div>
            <CarouselControls className="carousel__controls--home" />
            {books.length === 0 && (
              <p className="home__books-status">
                {booksError
                  ? t("featured.error")
                  : t("featured.loading")}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
