<script>
export let key = "A";
</script>

<div class="roundButton">
  <div class="key">{key}</div>
  <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <circle 
      cx="50" cy="55" r="43" fill="white" stroke="#000" stroke-width="4"
    />
    <circle 
      cx="50" cy="45" r="43" fill="white" stroke="#000" stroke-width="4"
    />
    />
  </svg>
</div>

<style>
.roundButton {
  position: relative;
  width: 1.3em;
  height: 1.3em;
}

.roundButton svg {
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