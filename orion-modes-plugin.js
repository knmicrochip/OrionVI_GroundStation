/**
 * Orion VI Operating Modes Plugin (ERC 2026)
 * 
 * Operating modes are natively defined in Open MCT as:
 * - Tabs View: orion.taxonomy:modes_tab (contains all 7 displays)
 * - Display Layouts: orion.taxonomy:disp_overview, disp_teleop, disp_nav, etc.
 * 
 * No website-like DOM injection or innerHTML workspace replacement is performed.
 * All displays render natively through Open MCT's built-in DisplayLayout and Tabs components.
 */

(function () {
    function OrionModesPlugin() {
        return function install(openmct) {
            // Displays and Tabs are provided natively through orion.taxonomy in orion-dictionary-plugin.js
        };
    }

    if (typeof window !== 'undefined') {
        window.OrionModesPlugin = OrionModesPlugin;
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = OrionModesPlugin;
    }
})();
