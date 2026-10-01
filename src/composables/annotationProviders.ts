// The declared sources of comments on a file (common/fileAnnotations.ts), as the config last said.
//
// A module of its own rather than one more field on `useAppConfig()`: the Files pane is the only
// reader, it is mounted in two places, and all it needs is this one list — not a preset manager
// and a config loader per mount. `useAppConfig` fills it in whenever the config is read.
import { ref } from "vue";
import type { AnnotationProvider } from "../../common/fileAnnotations";

export const annotationProviders = ref<AnnotationProvider[]>([]);
