/* Thin Emscripten entry point over libadmesh. Reads a binary STL from MEMFS at
 * inPath, runs the EXACT ADMesh repair configuration validated against the
 * production slicer in spike/FINDINGS.md (fill holes, fix normal directions
 * and values — NOT the broader default "fixall" superset, and NOT nearby-facet
 * connection or reverse-all, neither of which was part of the validated run),
 * and writes a binary STL to outPath. Returns 0 on success, 1 on failure. File
 * I/O goes through MEMFS, which the JS side populates/reads via the Emscripten
 * FS API. */
#include <emscripten.h>
#include "stl.h"

EMSCRIPTEN_KEEPALIVE
int repair(const char *inPath, const char *outPath) {
  stl_file stl;
  /* No explicit stl_initialize() here — stl_open() calls it internally as
   * its first statement, so a separate call would be redundant. */
  stl_open(&stl, (char *)inPath);
  if (stl_get_error(&stl)) {
    /* ADMesh's stl_close() early-returns WITHOUT freeing internal buffers if
     * stl->error is set — that's a quirk of the library, not a defensive
     * check on our part. This module instance is cached and reused across
     * calls (see repair-admesh.mjs), so repeated failing inputs would
     * otherwise leak WASM heap. Clear the error first so stl_close() actually
     * frees.
     *
     * RESIDUAL (not fully closed by this fix): stl_open() itself skips
     * fclose() on the input file handle when it sets stl->error. Clearing
     * the error and calling stl_close() here frees ADMesh's internal
     * buffers, but does NOT retroactively close that already-skipped file
     * handle — a MEMFS fp can still leak on some stl_open failure paths.
     * repair-admesh.mjs's assertRepairableStlSize() pre-validation (Task 2
     * Step 4) keeps the most common cause (undersized/malformed STL, below
     * ADMesh's own 284-byte / 4-triangle floor) from ever reaching stl_open
     * at all, but does not guarantee every other stl_open failure is
     * leak-free. See the RESIDUAL note in Global Constraints. */
    stl_clear_error(&stl);
    stl_close(&stl);
    return 1;
  }

  /* Mirrors, EXACTLY, the CLI invocation validated against OrcaSlicer in
   * spike/FINDINGS.md: `admesh --fill-holes --normal-directions
   * --normal-values` (fixall=0). Nearby-facet connection and reverse-all were
   * NOT part of the validated run and are deliberately left off — running the
   * broader default "fixall" sequence would be an unvalidated superset.
   * tolerance/increment are left to ADMesh's computed defaults (flags 0 =>
   * auto). */
  stl_repair(&stl,
             0, /* fixall_flag             */
             0, /* exact_flag (auto)       */
             0, /* tolerance_flag          */
             0, /* tolerance               */
             0, /* increment_flag          */
             0, /* increment               */
             0, /* nearby_flag             */
             2, /* iterations              */
             0, /* remove_unconnected_flag */
             1, /* fill_holes_flag         */
             1, /* normal_directions_flag  */
             1, /* normal_values_flag      */
             0, /* reverse_all_flag        */
             0  /* verbose_flag            */);

  stl_write_binary(&stl, (char *)outPath, "sliceready");
  int err = stl_get_error(&stl);
  /* Same ADMesh quirk as above: clear the error before the final stl_close()
   * so buffers are freed regardless of outcome, since this module instance is
   * cached and reused for subsequent repairs. */
  stl_clear_error(&stl);
  stl_close(&stl);
  return err ? 1 : 0;
}
