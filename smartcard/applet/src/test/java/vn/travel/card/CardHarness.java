package vn.travel.card;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.licel.jcardsim.smartcardio.CardSimulator;
import com.licel.jcardsim.utils.AIDUtil;
import java.util.Arrays;
import javacard.framework.AID;
import javax.smartcardio.CommandAPDU;
import javax.smartcardio.ResponseAPDU;

/** Test harness: installs the applet in jCardSim and sends APDUs. */
public final class CardHarness {
    public static final byte[] CARD_ID = filled(16, (byte) 0x11);
    public static final String PIN = "482915";

    static final byte[] APPLET_AID = {
        (byte) 0xF0, 0x54, 0x52, 0x41, 0x56, 0x45, 0x4C, 0x01
    };
    static final byte[] OTHER_AID = {
        (byte) 0xF0, 0x54, 0x52, 0x41, 0x56, 0x45, 0x4C, 0x7F
    };

    private final CardSimulator sim;
    private final AID aid;

    private CardHarness() {
        this(TravelCardApplet.class);
    }

    CardHarness(Class<? extends javacard.framework.Applet> appletClass) {
        sim = new CardSimulator();
        aid = AIDUtil.create(APPLET_AID);
        sim.installApplet(aid, appletClass);
        sim.installApplet(AIDUtil.create(OTHER_AID), OtherApplet.class);
        sim.selectApplet(aid);
    }

    static CardHarness fresh(Class<? extends javacard.framework.Applet> appletClass) {
        return new CardHarness(appletClass);
    }


    /** Minimal applet used only to deselect ours. */
    public static final class OtherApplet extends javacard.framework.Applet {
        public static void install(byte[] b, short o, byte l) {
            new OtherApplet().register();
        }

        public void process(javacard.framework.APDU apdu) {}
    }

    /** Fresh card with the applet installed and selected, in CREATED state. */
    public static CardHarness fresh() {
        return new CardHarness();
    }

    public ResponseAPDU send(int ins, int p1, int p2, byte[] data) {
        return sendCla(0x80, ins, p1, p2, data);
    }

    public ResponseAPDU sendCla(int cla, int ins, int p1, int p2, byte[] data) {
        CommandAPDU cmd = (data == null || data.length == 0)
                ? new CommandAPDU(cla, ins, p1, p2, 256)
                : new CommandAPDU(cla, ins, p1, p2, data, 256);
        return sim.transmitCommand(cmd);
    }

    public byte[] ok(int ins, int p1, int p2, byte[] data) {
        ResponseAPDU r = send(ins, p1, p2, data);
        assertEquals(0x9000, r.getSW(), () -> String.format("SW=%04X", r.getSW()));
        return r.getData();
    }

    public void assertSw(int expectedSw, int ins, int p1, int p2, byte[] data) {
        assertEquals(expectedSw, send(ins, p1, p2, data).getSW());
    }

    /** Deselect by selecting another applet (or none), then select ours again. */
    public void reselect() {
        sim.selectApplet(AIDUtil.create(OTHER_AID));
        sim.selectApplet(aid);
    }

    static byte[] filled(int n, byte v) {
        byte[] b = new byte[n];
        Arrays.fill(b, v);
        return b;
    }
}
