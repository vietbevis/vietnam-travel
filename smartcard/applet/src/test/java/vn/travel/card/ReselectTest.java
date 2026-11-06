package vn.travel.card;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class ReselectTest {
    public static class Probe extends TravelCardApplet {
        static int deselects;
        static int installs;

        public static void install(byte[] b, short o, byte l) {
            installs++;
            new Probe().register();
        }

        public void deselect() {
            deselects++;
            super.deselect();
        }
    }

    @Test
    void reselectKeepsAppletInstanceAndFiresDeselect() {
        Probe.deselects = 0;
        Probe.installs = 0;
        CardHarness h = CardHarness.fresh(Probe.class);
        h.reselect();
        assertEquals(1, Probe.deselects);
        assertEquals(1, Probe.installs); // never deleted/reinstalled: persistent state kept
        assertEquals(21, h.ok(0x10, 0, 0, null).length);
    }
}
