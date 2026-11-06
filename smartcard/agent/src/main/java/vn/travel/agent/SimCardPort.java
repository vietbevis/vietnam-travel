package vn.travel.agent;

import com.licel.jcardsim.smartcardio.CardSimulator;
import com.licel.jcardsim.utils.AIDUtil;
import java.util.ArrayList;
import java.util.List;
import javacard.framework.AID;
import javax.smartcardio.CommandAPDU;
import javax.smartcardio.ResponseAPDU;
import vn.travel.card.TravelCardApplet;

/** Các thẻ ảo chạy trên jCardSim; mỗi slot có applet được cài sẵn. */
public final class SimCardPort implements CardPort {
    static final byte[] APPLET_AID = {
        (byte) 0xF0, 0x54, 0x52, 0x41, 0x56, 0x45, 0x4C, 0x01
    };
    static final byte[] OTHER_AID = {
        (byte) 0xF0, 0x54, 0x52, 0x41, 0x56, 0x45, 0x4C, 0x7F
    };

    /** Applet tối giản chỉ dùng để bỏ chọn applet của thẻ (jCardSim không có deselect). */
    public static final class DummyApplet extends javacard.framework.Applet {
        public static void install(byte[] b, short o, byte l) {
            new DummyApplet().register();
        }

        @Override
        public void process(javacard.framework.APDU apdu) {}
    }

    private final Object lock = new Object();
    private final CardSimulator[] sims;
    private final AID aid = AIDUtil.create(APPLET_AID);
    private final AID otherAid = AIDUtil.create(OTHER_AID);
    private int slot;

    public SimCardPort(int slots) {
        if (slots < 1) {
            throw new IllegalArgumentException("Số slot phải dương");
        }
        sims = new CardSimulator[slots];
        for (int i = 0; i < slots; i++) {
            sims[i] = newCard();
        }
    }

    private CardSimulator newCard() {
        CardSimulator s = new CardSimulator();
        s.installApplet(aid, TravelCardApplet.class);
        s.installApplet(otherAid, DummyApplet.class);
        return s;
    }

    /** Với applet, việc này giống như rút thẻ: bỏ chọn rồi chọn lại (mất trạng thái tạm thời như phiên PIN). */
    private void cycle(CardSimulator s) {
        s.selectApplet(otherAid);
        s.selectApplet(aid);
    }

    public void selectSlot(int newSlot) {
        synchronized (lock) {
            if (newSlot < 0 || newSlot >= sims.length) {
                throw new IllegalArgumentException("Slot phải nằm trong khoảng 0.." + (sims.length - 1));
            }
            cycle(sims[slot]);
            slot = newSlot;
            cycle(sims[slot]);
        }
    }

    public void resetSlot(int s) {
        synchronized (lock) {
            if (s < 0 || s >= sims.length) {
                throw new IllegalArgumentException("Slot phải nằm trong khoảng 0.." + (sims.length - 1));
            }
            sims[s] = newCard();
            cycle(sims[s]);
        }
    }

    @Override
    public List<byte[]> transmitBatch(List<byte[]> apdus) {
        synchronized (lock) {
            CardSimulator s = sims[slot];
            List<byte[]> out = new ArrayList<>();
            for (byte[] apdu : apdus) {
                ResponseAPDU r = s.transmitCommand(new CommandAPDU(apdu));
                byte[] resp = r.getBytes();
                out.add(resp);
                if (r.getSW() != 0x9000) {
                    break;
                }
            }
            return out;
        }
    }

    @Override
    public String readerName() {
        return "jCardSim";
    }

    @Override
    public boolean cardPresent() {
        return true;
    }

    @Override
    public Integer slot() {
        synchronized (lock) {
            return slot;
        }
    }

    @Override
    public String mode() {
        return "sim";
    }
}
