/// <reference types="vite/client" />
import type { PtxApi } from './types/api'
declare global { interface Window { ptx: PtxApi } }
