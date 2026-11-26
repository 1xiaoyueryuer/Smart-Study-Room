package cn.studyroom;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.EncodeHintType;
import com.google.zxing.WriterException;
import com.google.zxing.qrcode.QRCodeWriter;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.Map;
import javax.imageio.ImageIO;

/** 二维码 PNG 的唯一生成实现；座位码与局域网接入地址共用同一编码参数。 */
public final class QrImages {
    private QrImages() {}
    public static byte[] png(String content,int size) {
        try {
            var matrix=new QRCodeWriter().encode(content,BarcodeFormat.QR_CODE,size,size,Map.of(EncodeHintType.MARGIN,4,EncodeHintType.CHARACTER_SET,"UTF-8"));
            var image=new BufferedImage(matrix.getWidth(),matrix.getHeight(),BufferedImage.TYPE_INT_RGB);
            for(int y=0;y<matrix.getHeight();y++) for(int x=0;x<matrix.getWidth();x++) image.setRGB(x,y,matrix.get(x,y)?0x000000:0xffffff);
            var output=new ByteArrayOutputStream();
            if(!ImageIO.write(image,"PNG",output)) throw new IllegalStateException("PNG编码器不可用");
            return output.toByteArray();
        } catch(WriterException|IOException e) { throw new IllegalStateException("二维码图片生成失败",e); }
    }
}
