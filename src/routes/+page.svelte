<main class="page">
  <nav class="links" aria-label="Autograph pages">
    <a href="/vr">Autograph</a>
    <a href="/pes">PES</a>
    <a href="/trajectory">Trajectory</a>
  </nav>
</main>

<style>
@font-face {
  font-family: "Quicksand-Bold";
  src:
    url("/fonts/Quicksand-Bold.woff2") format("woff2"),
    url("/fonts/Quicksand-Bold.woff") format("woff"),
    url("/fonts/Quicksand-Bold.ttf") format("truetype");

  font-weight: normal;
  font-style: normal;
}

@font-face {
  font-family: "Quicksand";
  src:
    url("/fonts/Quicksand-Regular.woff2") format("woff2"),
    url("/fonts/Quicksand-Regular.woff") format("woff"),
    url("/fonts/Quicksand-Regular.ttf") format("truetype");

  font-weight: normal;
  font-style: normal;
}

:global(body) {
  margin: 0;
  background: #f0f0f0;
  font-family: "Quicksand", sans-serif;
}

.page {
  display: flex;
  min-height: 100vh;
  align-items: center;
  justify-content: center;
  background: #f0f0f0;
}

.links {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
}

a {
  color: #000000;
  font-family: "Quicksand-Bold", sans-serif;
  font-size: clamp(2rem, 4vw, 3.4rem);
  line-height: 1;
  text-decoration: none;
}

a:hover,
a:focus-visible {
  text-decoration: underline;
  text-underline-offset: 0.16em;
}
</style>
