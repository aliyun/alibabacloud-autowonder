package com.aliyun.autowonder.auth.federation;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface FederatedIdentityDao {
    int insert(FederatedIdentityDO identity);

    FederatedIdentityDO findBinding(@Param("providerId") Long providerId,
                                    @Param("issuer") String issuer,
                                    @Param("subject") String subject);

    FederatedIdentityDO findById(@Param("id") Long id);

    List<FederatedIdentityDO> listByUser(@Param("userId") Long userId);

    long countByUser(@Param("userId") Long userId);

    /** 加锁读该账号的首条身份绑定：自动绑定前用它确认账号尚未被其它 SSO 身份占用。 */
    FederatedIdentityDO findBindingForUpdate(@Param("userId") Long userId);

    long countByProvider(@Param("providerId") Long providerId);

    int updateLastLogin(@Param("id") Long id,
                        @Param("displayName") String displayName,
                        @Param("email") String email);

    int deleteById(@Param("id") Long id);
}
