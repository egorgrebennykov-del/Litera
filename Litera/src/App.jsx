import Discount from "./components/discount/Discount";
import Featured from "./components/featured/Featured";
import NewBooks from "./components/newbooks/NewBooks";
import Testimonial from "./components/testimonial/Testimonial";
import Footer from "./components/footer/Footer";
import Header from "./components/header/Header";
import Home from "./components/home/Home";
import Join from "./components/join/Join";
import Login from "./components/login/Login";
import Search from "./components/search/Search";
import SearchResults from "./components/searchresults/SearchResults";
import BookDetails from "./components/bookdetails/BookDetails";
import Profile from "./components/profile/Profile";
import Orders from "./components/orders/Orders";
import Privileged from "./components/privileged/Privileged";
import Cart from "./components/cart/Cart";
import Checkout from "./components/checkout/Checkout";
import SignUp from "./components/signup/SignUp";
import LiteraAssistant from "./components/litera/LiteraAssistant";
import NotFound from "./components/notfound/NotFound";
import Contacts from "./components/contacts/Contacts";
import { useEffect, useState } from "react";
import {
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigate,
} from "react-router";
import { isLoggedIn } from "../utils/auth";
import { getCookie, setCookie } from "../utils/cookies";

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
      <meta charSet="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <link
        rel="shortcut icon"
        href="assets/img/favicon.png"
        type="image/x-icon"
      />
      <link
        rel="stylesheet"
        href="https://cdnjs.cloudflare.com/ajax/libs/remixicon/3.5.0/remixicon.css"
      />
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&family=Playfair+Display:ital,wght@0,500;0,600;0,700;1,500&display=swap"
      />
      <link rel="stylesheet" href="assets/css/swiper-bundle.min.css" />
      <link rel="stylesheet" href="/assets/css/styles.css" />
      <title>Litera</title>
      <Header
        theme={theme}
        isLight={lightTheme}
        onSearch={() => setShowSearch(true)}
      />
      <Search show={showSearch} onClose={() => setShowSearch(false)} />
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

      <main className="main"></main>
      <LiteraAssistant />
      <Footer />
      <a href="#" className="scrollup" id="scroll-up">
        <i className="ri-arrow-up-line" />
      </a>
    </>
  );
}

export default App;
