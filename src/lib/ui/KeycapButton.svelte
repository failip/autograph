<script>
export let key = "A";
</script>

<div class="keyButton">
  <div class="key">{key}</div>
  <svg id="Ebene_2" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 86">
    <g id="Ebene_1-2" data-name="Ebene_1">
      <path
        d="M63.08,4c7.12,0,12.92,5.79,12.92,12.92v52.17c0,7.12-5.79,12.92-12.92,12.92H16.92c-7.12,0-12.92-5.79-12.92-12.92V16.92c0-7.12,5.79-12.92,12.92-12.92h46.17M63.08,0H16.92C7.57,0,0,7.57,0,16.92v52.17c0,9.34,7.57,16.92,16.92,16.92h46.17c9.34,0,16.92-7.57,16.92-16.92V16.92c0-9.34-7.57-16.92-16.92-16.92h0Z"
      />
      <path
        d="M63.08,4c7.12,0,12.92,5.79,12.92,12.92v38.17c0,7.12-5.79,12.92-12.92,12.92H16.92c-7.12,0-12.92-5.79-12.92-12.92V16.92c0-7.12,5.79-12.92,12.92-12.92h46.17M63.08,0H16.92C7.57,0,0,7.57,0,16.92v38.17c0,9.34,7.57,16.92,16.92,16.92h46.17c9.34,0,16.92-7.57,16.92-16.92V16.92c0-9.34-7.57-16.92-16.92-16.92h0Z"
      />
    </g>
  </svg>
</div>

<style>
.keyButton {
  position: relative;
  height: 1.3em;
  width: 1.3em;
}

.keyButton svg {
  transform: translate(0, 0em);
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}

.key {
  position: absolute;
  top: 0.16em;
  font-size: 0.7em;
  font-weight: 100;
  width: 100%;
  height: 100%;
  text-align: center;
  font-weight: 300;
  font-family:
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    Roboto,
    Oxygen,
    Ubuntu,
    Cantarell,
    "Open Sans",
    "Helvetica Neue",
    sans-serif;
}
</style>
