<script>
export let key = "A";
</script>

<div class="sideButton">
  <div class="key">{key}</div>
  <svg viewBox="0 0 160 86" xmlns="http://www.w3.org/2000/svg" class="sideButtonSvg">
    <path
      d="
         M150,4 c4,0 10,4 10,10 v58 c0,5 -5,10 -10,10 H34 a32,32 0 0 1 -32,-32 v-14 a32,32 0 0 1 32,-32 H150 z 
      "
      fill="none"
      stroke="#000"
      stroke-width="4"
    />
    <path
      d="
        M150,4 c4,0 10,4 10,10 v44 c0,5 -5,10 -10,10 H34 a32,32 0 0 1 -32,-32 a32,32 0 0 1 32,-32 H150 z 
      "
      fill="white"
      stroke="#000"
      stroke-width="4"
    />
  </svg>
</div>


<style>
.sideButton {
  position: relative;
  width: 2.6em;
  height: 1.3em;
}

.sideButton svg {
  width: 100%;
  height: 100%;
}

.sideButtonShape {
  fill: #ddd;
  stroke: #aaa;
  stroke-width: 1;
}

.sideButtonShadow {
  fill: #666;
  opacity: 0.4;
  transform: translate(3px, 3px);
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