/** hls.js ships no declarations for its `./light` entry; it has the same API. */
declare module 'hls.js/light' {
    import Hls from 'hls.js';
    export default Hls;
}
