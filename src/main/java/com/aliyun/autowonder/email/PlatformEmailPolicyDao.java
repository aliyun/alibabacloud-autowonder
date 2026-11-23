package com.aliyun.autowonder.email;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface PlatformEmailPolicyDao {
    PlatformEmailPolicyDO find();

    int insert(PlatformEmailPolicyDO row);

    /** 版本条件更新：策略版本不一致时返回 0，调用方据此报冲突。 */
    int update(@Param("row") PlatformEmailPolicyDO row, @Param("expectedVersion") long expectedVersion);
}
