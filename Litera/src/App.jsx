import { lazy, Suspense, useEffect, useState } from "react";
import {
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigate,
} from "react-router";
import Footer from "./components/footer/Footer";
import Header from "./components/header/Header";
import Home from "./components/home/Home";
import Search from "./components/search/Search";
import { isLoggedIn } from "../utils/auth";
import { getCookie, setCookie } from "../utils/cookies";
import getBookPicks from "../utils/getBookPicks";
import getDiscountSnapshot from "../utils/getDiscountSnapshot";
import getNewBooks from "../utils/getNewBooks";
import getExchangeRate from "../utils/getExchangeRate";
import getHomepageBooks from "../utils/getHomepageBooks";
import { fetchActiveAnnouncements } from "../utils/announcements";

// Immediately warm critical homepage data as soon as the bundle loads
if (typeof window !== "undefined") {
  getHomepageBooks().catch(() => {});
  fetchActiveAnnouncements().catch(() => {});
  getExchangeRate().catch(() => {});
}

const loadFeatured = () => import("./components/featured/Featured");
const loadDiscount = () => import("./components/discount/Discount");
const loadNewBooks = () => import("./components/newbooks/NewBooks");
const loadTestimonial = () => import("./components/testimonial/Testimonial");
const loadContacts = () => import("./components/contacts/Contacts");
const loadCart = () => import("./components/cart/Cart");
const loadCheckout = () => import("./components/checkout/Checkout");
const loadSearchResults = () => import("./components/searchresults/SearchResults");
const loadBookDetails = () => import("./components/bookdetails/BookDetails");
const loadProfile = () => import("./components/profile/Profile");
const loadOrders = () => import("./components/orders/Orders");
const loadPrivileged = () => import("./components/privileged/Privileged");
const loadLogin = () => import("./components/login/Login");
const loadSignUp = () => import("./components/signup/SignUp");
const loadJoin = () => import("./components/join/Join");
const loadNotFound = () => import("./components/notfound/NotFound");
const loadLiteraAssistant = () => import("./components/litera/LiteraAssistant");

const Featured = lazy(loadFeatured);
const Discount = lazy(loadDiscount);
const NewBooks = lazy(loadNewBooks);
const Testimonial = lazy(loadTestimonial);
const Contacts = lazy(loadContacts);
const Cart = lazy(loadCart);
const Checkout = lazy(loadCheckout);
const SearchResults = lazy(loadSearchResults);
const BookDetails = lazy(loadBookDetails);
const Profile = lazy(loadProfile);
const Orders = lazy(loadOrders);
const Privileged = lazy(loadPrivileged);
const Login = lazy(loadLogin);
const SignUp = lazy(loadSignUp);
const Join = lazy(loadJoin);
const NotFound = lazy(loadNotFound);
const LiteraAssistant = lazy(loadLiteraAssistant);

const THEME_COOKIE_KEY = "litera_theme";

function getInitialTheme() {
  if (typeof document === "undefined") return true;
  try {
    const saved = getCookie(THEME_COOKIE_KEY) || getCookie("theme");
    if (saved === "dark") return false;
    if (saved === "light") return true;
  } catch {
    // Ignore error
  }
  // Default: light theme
  return true;
}

function GuestOnly({ children }) {
  return isLoggedIn() ? <Navigate to="/" replace /> : children;
}

function App() {
  const [lightTheme, setLightTheme] = useState(getInitialTheme);
  const [showSearch, setShowSearch] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const shouldRestoreScroll = Boolean(
    location.state?.restoreCartScroll ||
    location.state?.restoreDiscountScroll ||
    location.state?.restoreHomeScroll,
  );

  useEffect(() => {
    fetch("/api/warmup", { method: "POST" }).catch(() => {});

    // Prefetch primary navigation pages and catalogue snapshots immediately after initial paint
    const timer = setTimeout(() => {
      getBookPicks().catch(() => {});
      getDiscountSnapshot().catch(() => {});
      getNewBooks().catch(() => {});
      loadFeatured();
      loadDiscount();
      loadNewBooks();
      loadTestimonial();
      loadContacts();
      loadBookDetails();
      loadSearchResults();
    }, 150);

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (shouldRestoreScroll) return;
    window.scrollTo(0, 0);
  }, [location.pathname, location.search, shouldRestoreScroll]);

  useEffect(() => {
    document.body.classList.toggle("dark-theme", !lightTheme);
    setCookie(THEME_COOKIE_KEY, lightTheme ? "light" : "dark");
  }, [lightTheme]);

  const theme = () => {
    setLightTheme((currentTheme) => !currentTheme);
  };

  const login = () => navigate(`/login${location.search}`);
  const signUp = () => navigate(`/sign-up${location.search}`);
  const closeAuth = () => navigate("/");

  return (
    <>
      <Header
        theme={theme}
        isLight={lightTheme}
        onSearch={() => setShowSearch(true)}
      />
      <Search show={showSearch} onClose={() => setShowSearch(false)} />
      <Suspense fallback={<div style={{ minHeight: "65vh" }} />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route
            path="/login"
            element={
              <GuestOnly>
                <Login onSignUp={signUp} onClose={closeAuth} />
              </GuestOnly>
            }
          />
          <Route
            path="/sign-up"
            element={
              <GuestOnly>
                <SignUp onLogin={login} onClose={closeAuth} />
              </GuestOnly>
            }
          />
          <Route path="/join" element={<Join />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/orders" element={<Orders defaultTab="current" key="orders-current" />} />
          <Route path="/orders/current" element={<Orders defaultTab="current" key="orders-current" />} />
          <Route path="/orders/completed" element={<Orders defaultTab="completed" key="orders-completed" />} />
          <Route path="/privileged" element={<Privileged />} />
          <Route path="/admin" element={<Privileged />} />
          <Route
            path="/cart"
            element={<Cart onSearch={() => setShowSearch(true)} />}
          />
          <Route path="/checkout" element={<Checkout />} />
          <Route path="/search" element={<SearchResults />} />
          <Route path="/book" element={<BookDetails />} />
          <Route path="/featured" element={<Featured />} />
          <Route path="/discount" element={<Discount />} />
          <Route path="/new" element={<NewBooks />} />
          <Route path="/testimonial" element={<Testimonial />} />
          <Route path="/contacts" element={<Contacts />} />
          <Route path="/404" element={<NotFound />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>

      <main className="main"></main>
      <Suspense fallback={null}>
        <LiteraAssistant />
      </Suspense>
      <Footer />
      <a href="#" className="scrollup" id="scroll-up">
        <i className="ri-arrow-up-line" />
      </a>
    </>
  );
}

export default App;
