package com.aliyun.autowonder.auth.filter;

import com.aliyun.autowonder.auth.jwt.JwtService;
import com.aliyun.autowonder.auth.session.SessionService;
import com.aliyun.autowonder.email.EmailVerificationPolicyService;
import com.aliyun.autowonder.email.EmailVerificationTokenService;
import com.aliyun.autowonder.workspace.WorkspaceDao;
import com.aliyun.autowonder.workspace.WorkspaceMemberDao;
import com.aliyun.autowonder.user.UserDao;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.LocaleResolver;
import org.springframework.web.servlet.i18n.AcceptHeaderLocaleResolver;
import com.aliyun.autowonder.common.i18n.SystemMessages;

@Configuration
public class AuthFilterConfig {

    @Bean(name = "localeResolver")
    public LocaleResolver localeResolver() {
        return new AcceptHeaderLocaleResolver() {
            @Override
            public java.util.Locale resolveLocale(javax.servlet.http.HttpServletRequest request) {
                return SystemMessages.resolveAcceptLanguage(request.getHeader("Accept-Language"));
            }
        };
    }

    @Bean
    public FilterRegistrationBean<AuthFilter> authFilterRegistration(
            JwtService jwtService, SessionService sessionService,
            WorkspaceMemberDao workspaceMemberDao, WorkspaceDao workspaceDao, UserDao userDao,
            ObjectProvider<EmailVerificationPolicyService> emailVerificationPolicyService,
            ObjectProvider<EmailVerificationTokenService> emailVerificationTokenService) {
        return buildRegistration(jwtService, sessionService, workspaceMemberDao, workspaceDao, userDao,
                emailVerificationPolicyService.getIfAvailable(), emailVerificationTokenService.getIfAvailable());
    }

    /** 兼容既有调用（测试与历史装配）：未提供邮箱验证依赖时保持旧行为。 */
    FilterRegistrationBean<AuthFilter> authFilterRegistration(
            JwtService jwtService, SessionService sessionService,
            WorkspaceMemberDao workspaceMemberDao, WorkspaceDao workspaceDao, UserDao userDao) {
        return buildRegistration(jwtService, sessionService, workspaceMemberDao, workspaceDao, userDao, null, null);
    }

    private FilterRegistrationBean<AuthFilter> buildRegistration(
            JwtService jwtService, SessionService sessionService,
            WorkspaceMemberDao workspaceMemberDao, WorkspaceDao workspaceDao, UserDao userDao,
            EmailVerificationPolicyService emailVerificationPolicyService,
            EmailVerificationTokenService emailVerificationTokenService) {
        FilterRegistrationBean<AuthFilter> reg = new FilterRegistrationBean<>();
        reg.setFilter(new AuthFilter(jwtService, sessionService, workspaceMemberDao, workspaceDao, userDao,
                emailVerificationPolicyService, emailVerificationTokenService));
        reg.addUrlPatterns("/api/*");
        reg.setOrder(1);
        return reg;
    }
}
