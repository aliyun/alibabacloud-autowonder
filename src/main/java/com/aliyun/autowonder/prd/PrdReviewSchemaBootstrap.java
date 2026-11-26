package com.aliyun.autowonder.prd;

import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.datasource.init.ScriptUtils;
import org.springframework.stereotype.Component;
import javax.sql.DataSource;

@Component
public class PrdReviewSchemaBootstrap implements ApplicationRunner {
    private final DataSource dataSource;
    public PrdReviewSchemaBootstrap(DataSource dataSource) { this.dataSource=dataSource; }
    @Override public void run(ApplicationArguments args) {
        try(var connection=dataSource.getConnection()) {
            if(connection.getMetaData().getDatabaseProductName().toLowerCase(java.util.Locale.ROOT).contains("mysql")) {
                ScriptUtils.executeSqlScript(connection,new ClassPathResource("schema/prd-review.sql"));
                ScriptUtils.executeSqlScript(connection,new ClassPathResource("schema/workitem-launch.sql"));
                ScriptUtils.executeSqlScript(connection,new ClassPathResource("schema/prd-design-handoff.sql"));
            }
        } catch(Exception error) {
            LoggerFactory.getLogger(getClass()).warn("PRD schema initialization failed; check the review and workitem-launch migrations",error);
        }
    }
}
