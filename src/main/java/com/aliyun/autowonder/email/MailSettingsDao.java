package com.aliyun.autowonder.email;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface MailSettingsDao {
    MailSettingsDO find();

    int insert(MailSettingsDO row);

    /** 草稿乐观锁更新；active_* 由调用方按激活结果填入。 */
    int updateDraft(@Param("row") MailSettingsDO row, @Param("expectedVersion") long expectedVersion);

    /** 只更新测试结果，版本不前进；测试不改变配置内容。 */
    int recordTest(@Param("row") MailSettingsDO row, @Param("expectedVersion") long expectedVersion);

    /** 保存新密钥到草稿并推进密钥版本；配置不变；draft 版本条件更新防止并发覆盖。 */
    int updateDraftSecret(@Param("secretRef") String secretRef, @Param("secretVersion") long secretVersion,
                          @Param("updatedBy") Long updatedBy,
                          @Param("expectedVersion") long expectedVersion);
}
