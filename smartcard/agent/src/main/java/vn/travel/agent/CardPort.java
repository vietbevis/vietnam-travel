package vn.travel.agent;

import java.util.List;

/** Truy cập một thẻ. Mọi lần truy cập thẻ của mỗi lớp cài đặt đều được tuần tự hóa dưới khóa riêng của cổng đó (mỗi cổng một khóa). */
public interface CardPort {
    /**
     * Gửi lần lượt các APDU. Mỗi phần tử trả về có dạng {@code data || SW1 SW2}.
     * Dừng sau phản hồi đầu tiên có SW khác 9000.
     * Nếu lỗi xảy ra giữa chừng thì ném ngoại lệ và mất các phản hồi đã nhận trước đó.
     */
    List<byte[]> transmitBatch(List<byte[]> apdus) throws NoCardException;

    String readerName();

    boolean cardPresent();

    /** Slot giả lập đang dùng, hoặc null với PC/SC. */
    Integer slot();

    /** Chế độ: "sim" hoặc "pcsc". */
    String mode();
}
