package com.aliyun.autowonder.squad.dto;

import lombok.Getter;
import lombok.Setter;
import java.util.List;

@Getter
@Setter
public class SquadMemberVO {
    private Long agentId;
    private String agentName;
    /** STANDARD=普通数字员工 / PLATFORM=平台数字人 */
    private String agentKind;
    private String roleCode;
    private String roleName;
    private String responsibilities;
    private Long sdlcId;
    private String sdlcName;
    private List<String> systemTags;
    private List<String> customTags;
    private List<SdlcStepSummaryVO> sdlcSteps;
    /** 该数字员工是否至少有一个在线执行器 */
    private boolean executorOnline;

    @Getter
    @Setter
    public static class SdlcStepSummaryVO {
        private Long id;
        private Integer stepOrder;
        private String name;
        private String handlerType;
        private String handlerRoleRef;
    }
}
