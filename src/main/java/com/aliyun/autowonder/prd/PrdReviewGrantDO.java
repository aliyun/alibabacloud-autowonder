package com.aliyun.autowonder.prd;
import lombok.Data;
import java.util.Date;
@Data
public class PrdReviewGrantDO {
    private String tokenHash;
    private String kind;
    private Long shareId;
    private Integer shareVersion;
    private Long userId;
    private String bindingId;
    private Date expiresAt;
    private Integer consumed;
}
