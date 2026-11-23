package com.aliyun.autowonder.email;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface EmailVerificationNoticeDao {
    /** 按策略版本去重：已存在时返回 0，避免重复通知。 */
    int insertIfAbsent(@Param("policyVersion") long policyVersion);

    int updateCounts(@Param("policyVersion") long policyVersion,
                     @Param("recipientCount") int recipientCount,
                     @Param("failureCount") int failureCount);
}
