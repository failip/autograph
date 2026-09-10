<script lang="ts">
import PwaStatus from "$lib/ui/PwaStatus.svelte";
</script>

<svelte:head>
  <title>Autograph</title>
</svelte:head>

<slot></slot>
<PwaStatus />

<style>
:global(body, html) {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
}
</style>
