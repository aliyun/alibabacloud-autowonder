package com.aliyun.autowonder.insights.delivery;

import org.junit.jupiter.api.Test;
import java.time.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static com.aliyun.autowonder.insights.delivery.DeliveryAnalyticsData.*;

class DeliveryAnalyticsCalculatorTest {
    final LocalDateTime now=LocalDateTime.parse("2026-11-03T18:00:00");
    Event event(long id,String type,String actor,String from,String to,String when) {
        return new Event(id,1,type,actor,from,to,null,LocalDateTime.parse(when));
    }
    static DeliveryAnalyticsData empty() {
        return new DeliveryAnalyticsData(List.of(),List.of(),List.of(),List.of(),List.of(),List.of());
    }
    @Test void reopenedRoundsSubtractFinalHandoffAndAttributeFullDurationToStart() {
        var events=List.of(
            event(1,"ASSIGN","HUMAN","HUMAN","AGENT","2026-10-10T10:00:00"),
            event(2,"ASSIGN","AGENT","AGENT","HUMAN","2026-10-11T10:00:00"),
            event(3,"ASSIGN","HUMAN","HUMAN","AGENT","2026-10-12T10:00:00"),
            event(4,"ASSIGN","AGENT","AGENT","HUMAN","2026-10-13T10:00:00"),
            event(5,"STATUS_CHANGE","HUMAN","IN_PROGRESS","DONE","2026-10-20T10:00:00"),
            event(6,"STATUS_CHANGE","HUMAN","DONE","NEW","2026-10-21T10:00:00"),
            event(7,"ASSIGN","HUMAN","HUMAN","AGENT","2026-10-22T10:00:00"),
            event(8,"STATUS_CHANGE","HUMAN","IN_PROGRESS","DONE","2026-10-23T10:00:00"));
        var report=new DeliveryAnalyticsCalculator(new MainlandWorkCalendar()).calculate(
            new DeliveryAnalyticsData(events,List.of(
                new Dispatch(1,1,LocalDateTime.parse("2026-10-10T10:00:00")),
                new Dispatch(2,1,LocalDateTime.parse("2026-10-22T10:00:00"))),List.of(),List.of(),List.of(),List.of()),now,90);
        assertEquals(2,report.summary().delivered());
        assertEquals(1,report.summary().humanTotal());
        assertEquals(.5,report.summary().human());
        assertEquals(1,report.summary().autonomous());
        assertEquals(132,report.summary().duration());
        assertEquals(2,report.weeks().stream().mapToLong(w->w.metrics().durationSamples()).sum());
        assertEquals(1,report.weeks().stream().mapToLong(w->w.metrics().humanTotal()).sum());
        assertTrue(report.weeks().getFirst().partial(),"The 90-day window starts mid-week and is truncated");
        var last=report.weeks().getLast();
        assertTrue(last.partial(),"The current week has not ended yet");
        assertEquals(LocalDateTime.parse("2026-11-02T00:00:00"),last.start());
        assertEquals(Duration.ofHours(42),Duration.between(last.start(),report.end()));
        assertEquals(LocalDate.parse("2026-11-02"),last.displayStart());
        assertEquals(LocalDate.parse("2026-11-03"),last.displayEnd());
    }
    @Test void autonomousRequiresFormalDispatchInTheSameCompletedRoundOnly() {
        var t=now.minusDays(10);
        var events=List.of(
            new Event(1,1,"STATUS_CHANGE","SYSTEM","NEW","DONE",null,t),
            new Event(2,1,"ASSIGN","HUMAN","HUMAN","AGENT",null,t.plusHours(1)),
            new Event(3,1,"STATUS_CHANGE","HUMAN","IN_PROGRESS","DONE",null,t.plusHours(2)),
            new Event(4,1,"STATUS_CHANGE","HUMAN","IN_PROGRESS","DONE",null,t.plusHours(4)),
            new Event(5,1,"STATUS_CHANGE","HUMAN","DONE","IN_PROGRESS",null,t.plusHours(5)),
            new Event(6,1,"STATUS_CHANGE","HUMAN","IN_PROGRESS","DONE",null,t.plusHours(6)));
        var dispatches=List.of(new Dispatch(1,1,t.plusHours(3)),new Dispatch(2,1,t.plusHours(7)));
        var data=new DeliveryAnalyticsData(events,dispatches,List.of(),List.of(),
            List.of(new Entry(1,t.minusHours(1))),List.of());
        var report=new DeliveryAnalyticsCalculator(new MainlandWorkCalendar()).calculate(data,now,30);
        assertEquals(4,report.summary().delivered(),"Non-executed completions remain throughput");
        assertEquals(100,report.summary().resolution(),"Seven-day resolution is unchanged");
        assertEquals(0,report.summary().human(),"Participation denominator is unchanged");
        assertEquals(1,report.summary().autonomous(),"Only the round with its own formal dispatch is autonomous");
        assertEquals(1,report.summary().autonomousRequirements());
        assertEquals(1,report.weeks().stream().mapToLong(w->w.metrics().autonomous()).sum());
    }

    @Test void concurrentTasksSumAndNightHolidayOverlapOnlyOnce() {
        var ds=new ArrayList<Dispatch>();var edges=new ArrayList<Edge>();
        for(int i=1;i<=3;i++){
            var a=LocalDateTime.parse("2026-10-27T01:00:00");
            ds.add(new Dispatch(i,i,a));
            edges.add(new Edge(i*2,i,i,"session.started",a));
            edges.add(new Edge(i*2+1,i,i,"session.completed",a.plusHours(1)));
        }
        var r=new DeliveryAnalyticsCalculator(new MainlandWorkCalendar()).calculate(
            new DeliveryAnalyticsData(List.of(),ds,edges,List.of(),List.of(),List.of()),now,30);
        assertEquals(3,r.summary().workhours());
        assertEquals(3,r.summary().offhours());
        assertEquals(0,r.summary().regularhours());
        assertEquals(3,r.summary().night());
        assertFalse(new MainlandWorkCalendar().isNonWorking(LocalDate.of(2026,10,10)));
        assertTrue(new MainlandWorkCalendar().isNonWorking(LocalDate.of(2026,10,1)));
    }
    @Test void sevenDayCohortUsesEntryAndMaturityAndSkillsIncludeAllTypes() {
        var e=event(1,"STATUS_CHANGE","HUMAN","IN_PROGRESS","DONE","2026-10-22T10:00:00");
        var entries=List.of(new Entry(1,LocalDateTime.parse("2026-10-20T10:00:00")),
            new Entry(2,now.minusDays(1)));
        var skills=List.of(new Skill("MCP",false,2,now.minusDays(10),now),
            new Skill("HOOK",true,3,now.minusDays(10),now.minusDays(2)));
        var r=new DeliveryAnalyticsCalculator(new MainlandWorkCalendar()).calculate(
            new DeliveryAnalyticsData(List.of(e),List.of(),List.of(),List.of(),entries,skills),now,30);
        assertEquals(100,r.summary().resolution());
        assertEquals(1,r.summary().resolutionObserving());
        assertEquals(1,r.summary().skill());
        assertEquals(6,r.summary().versions());
        assertNull(r.summary().duration());
        assertEquals(1,r.summary().durationMissing());
        assertThrows(IllegalArgumentException.class,()->new DeliveryAnalyticsCalculator(new MainlandWorkCalendar()).calculate(
            new DeliveryAnalyticsData(List.of(),List.of(),List.of(),List.of(),List.of(),List.of()),now,7));
    }
    @Test void overlappingSessionsAreUnionedAndReentryIntoExecutionStartsANewRound() {
        var a=now.minusDays(1);
        var edges=List.of(new Edge(1,1,1,"session.started",a,"A"),
            new Edge(2,1,1,"session.forked",a.plusMinutes(30),"B"),
            new Edge(3,1,1,"session.completed",a.plusHours(1),"B"),
            new Edge(4,1,1,"session.completed",a.plusHours(2),"A"));
        var events=List.of(
            new Event(1,1,"STATUS_CHANGE","HUMAN","IN_PROGRESS","DONE",null,a.minusDays(1)),
            new Event(2,1,"STATUS_CHANGE","HUMAN","DONE","IN_PROGRESS",null,a),
            new Event(3,1,"STATUS_CHANGE","HUMAN","IN_PROGRESS","DONE",null,a.plusHours(2)));
        var r=new DeliveryAnalyticsCalculator(new MainlandWorkCalendar()).calculate(
            new DeliveryAnalyticsData(events,List.of(),edges,List.of(),List.of(),List.of()),now,30);
        assertEquals(2,r.summary().workhours());
        assertEquals(1,r.summary().durationSamples());
        assertEquals(2,r.summary().duration());
        assertEquals(0,r.summary().human());
    }

    @Test void calculationHonorsExpiredBudgetAndHandlesLargeWaitingHistoryLinearly() {
        var calculator=new DeliveryAnalyticsCalculator(new MainlandWorkCalendar());
        var empty=new DeliveryAnalyticsData(List.of(),List.of(),List.of(),List.of(),List.of(),List.of());
        assertThrows(IllegalStateException.class,()->calculator.calculate(empty,now,90,System.nanoTime()-1));
        var edges=new ArrayList<Edge>();var waits=new ArrayList<Wait>();var a=now.minusDays(2);
        for(int i=0;i<20_000;i++){
            var start=a.plusSeconds(i*3L);
            edges.add(new Edge(i*2L,1,1,"session.started",start,"one"));
            edges.add(new Edge(i*2L+1,1,1,"session.completed",start.plusSeconds(2),"one"));
            waits.add(new Wait(1,start,start.plusSeconds(1)));
        }
        var data=new DeliveryAnalyticsData(List.of(),List.of(),edges,waits,List.of(),List.of());
        assertTimeoutPreemptively(Duration.ofSeconds(10),()->{
            var result=calculator.calculate(data,now,90);
            assertEquals(20_000d/3600,result.summary().workhours(),1e-6);
        });
    }

    @Test void unresolvableHistoricalStatusIsReportedInsteadOfSilentlyClaimingCompleteTotals() {
        var unknown=event(1,"STATUS_CHANGE","HUMAN","IN_PROGRESS",null,"2026-10-22T10:00:00");
        var r=new DeliveryAnalyticsCalculator(new MainlandWorkCalendar()).calculate(
            new DeliveryAnalyticsData(List.of(unknown),List.of(),List.of(),List.of(),List.of(),List.of()),now,30);
        assertEquals(1,r.unclassifiedEvents());
        assertEquals(0,r.summary().delivered());
    }

    @Test void roundStartedBeforeTheWindowCountsTowardsThroughputButNotTheHeadlineDuration() {
        var start=now.minusDays(40);
        var end=now.minusDays(2);
        var data=new DeliveryAnalyticsData(List.of(
            new Event(1,1,"STATUS_CHANGE","HUMAN","IN_PROGRESS","DONE",null,end)),
            List.of(new Dispatch(1,1,start)),List.of(),List.of(),List.of(),List.of());
        var calculator=new DeliveryAnalyticsCalculator(new MainlandWorkCalendar());
        var month=calculator.calculate(data,now,30);
        assertEquals(1,month.summary().delivered(),"The completion still counts as throughput");
        assertEquals(1,month.summary().humanStartedDeliveries(),"The participation cohort stays on completions");
        assertEquals(0d,month.summary().human());
        assertNull(month.summary().duration(),"A round started before the window is not a duration sample");
        assertEquals(0,month.summary().durationSamples());
        assertEquals(0,month.summary().durationMissing(),"A known start is not missing evidence");
        var quarter=calculator.calculate(data,now,90);
        assertEquals(912,quarter.summary().duration(),1e-9,"The same round becomes a sample once its start enters the window");
        assertEquals(1,quarter.summary().durationSamples());
    }

    @Test void roundStartedInsideTheWindowWithoutCompletionJoinsNeitherThroughputNorDuration() {
        var data=new DeliveryAnalyticsData(List.of(
            new Event(1,1,"STATUS_CHANGE","HUMAN","NEW","IN_PROGRESS",null,now.minusDays(3))),
            List.of(),List.of(),List.of(),List.of(),List.of());
        var report=new DeliveryAnalyticsCalculator(new MainlandWorkCalendar()).calculate(data,now,30);
        assertEquals(0,report.summary().delivered());
        assertNull(report.summary().duration());
        assertEquals(0,report.summary().durationSamples());
        assertEquals(0,report.summary().durationMissing());
    }

    @Test void headlineDurationIsTheSampleWeightedMeanOfWeeklyPoints() {
        // Two rounds in the latest bucket plus one in the previous bucket: the sample-weighted mean is 76h,
        // while a simple mean of the weekly means would be 102h.
        var dispatches=List.of(
            new Dispatch(1,1,now.minusDays(2)),
            new Dispatch(2,2,now.minusDays(3)),
            new Dispatch(3,3,now.minusDays(9)));
        var events=List.of(
            new Event(1,1,"STATUS_CHANGE","HUMAN","IN_PROGRESS","DONE",null,now.minusDays(2).plusHours(12)),
            new Event(2,2,"STATUS_CHANGE","HUMAN","IN_PROGRESS","DONE",null,now.minusDays(3).plusHours(36)),
            new Event(3,3,"STATUS_CHANGE","HUMAN","IN_PROGRESS","DONE",null,now.minusDays(9).plusHours(180)));
        var data=new DeliveryAnalyticsData(events,dispatches,List.of(),List.of(),List.of(),List.of());
        var calculator=new DeliveryAnalyticsCalculator(new MainlandWorkCalendar());
        for(int days:new int[]{30,60,90}){
            var report=calculator.calculate(data,now,days);
            assertEquals(3,report.summary().durationSamples(),"All three rounds start inside the window");
            double weighted=0;long samples=0;
            for(var week:report.weeks()){
                var metrics=week.metrics();
                if(metrics.duration()!=null&&metrics.durationSamples()>0){
                    weighted+=metrics.duration()*metrics.durationSamples();
                    samples+=metrics.durationSamples();
                }
            }
            assertEquals(samples,report.summary().durationSamples());
            assertEquals(weighted/samples,report.summary().duration(),1e-9);
            assertEquals(76,report.summary().duration(),1e-9,"Weighted by samples, not a simple mean of weekly means");
        }
    }

    @Test void completedRoundsWithoutStartEvidenceStayInDurationMissingOnly() {
        var inside=now.minusDays(5);
        var events=List.of(
            new Event(1,1,"STATUS_CHANGE","HUMAN","NEW","DONE",null,now.minusDays(2)),
            new Event(2,2,"STATUS_CHANGE","HUMAN","IN_PROGRESS","DONE",null,inside.plusHours(4)),
            new Event(3,3,"STATUS_CHANGE","HUMAN","IN_PROGRESS","DONE",null,now.minusDays(1)));
        var dispatches=List.of(
            new Dispatch(1,2,inside),
            new Dispatch(2,3,now.minusDays(40)));
        var report=new DeliveryAnalyticsCalculator(new MainlandWorkCalendar()).calculate(
            new DeliveryAnalyticsData(events,dispatches,List.of(),List.of(),List.of(),List.of()),now,30);
        assertEquals(3,report.summary().delivered());
        assertEquals(1,report.summary().durationSamples(),"Only the round started inside the window is a sample");
        assertEquals(4,report.summary().duration(),1e-9);
        assertEquals(1,report.summary().durationMissing(),"The completed round without start evidence is reported as missing");
    }

    @Test void naturalWeekBucketsUseMondayBoundariesForEveryPeriod() {
        var time=LocalDateTime.parse("2026-11-17T16:00:00");
        var calculator=new DeliveryAnalyticsCalculator(new MainlandWorkCalendar());
        var month=calculator.calculate(empty(),time,30);
        var half=calculator.calculate(empty(),time,60);
        var quarter=calculator.calculate(empty(),time,90);

        assertEquals(5,month.weeks().size());
        assertEquals(10,half.weeks().size());
        assertEquals(14,quarter.weeks().size());

        assertEquals(LocalDateTime.parse("2026-10-19T00:00:00"),month.weeks().getFirst().start());
        assertEquals(LocalDateTime.parse("2026-10-26T00:00:00"),month.weeks().getFirst().end());
        assertFalse(month.weeks().getFirst().partial(),"A window starting on Monday has a full first week");

        assertEquals(LocalDateTime.parse("2026-09-19T00:00:00"),half.weeks().getFirst().start());
        assertEquals(LocalDateTime.parse("2026-09-21T00:00:00"),half.weeks().getFirst().end());
        assertTrue(half.weeks().getFirst().partial());

        assertEquals(LocalDateTime.parse("2026-08-20T00:00:00"),quarter.weeks().getFirst().start());
        assertEquals(LocalDateTime.parse("2026-08-24T00:00:00"),quarter.weeks().getFirst().end());
        assertTrue(quarter.weeks().getFirst().partial());

        for(var report:List.of(month,half,quarter)){
            var weeks=report.weeks();
            assertEquals(report.start(),weeks.getFirst().start(),"The first bucket starts at the window start");
            assertEquals(report.end(),weeks.getLast().end(),"The last bucket ends at the refresh time");
            assertEquals(LocalDateTime.parse("2026-11-16T00:00:00"),weeks.getLast().start());
            assertTrue(weeks.getLast().partial(),"The running week is partial");
            assertTrue(Duration.between(weeks.getLast().start(),weeks.getLast().end()).compareTo(Duration.ofDays(7))<=0);
            for(int i=0;i<weeks.size();i++){
                var week=weeks.get(i);
                assertTrue(week.end().isAfter(week.start()),"Buckets must never be empty");
                if(i>0){
                    assertEquals(weeks.get(i-1).end(),week.start(),"Buckets must be contiguous");
                    assertEquals(DayOfWeek.MONDAY,week.start().getDayOfWeek());
                    assertEquals(LocalTime.MIDNIGHT,week.start().toLocalTime());
                }
                if(i>0&&i<weeks.size()-1) assertFalse(week.partial(),"Only the window edges are partial");
            }
        }
    }

    @Test void refreshExactlyOnMondayMidnightDoesNotEmitAZeroLengthBucket() {
        var time=LocalDateTime.parse("2026-11-16T00:00:00");
        var report=new DeliveryAnalyticsCalculator(new MainlandWorkCalendar()).calculate(empty(),time,30);
        var weeks=report.weeks();
        assertEquals(5,weeks.size());
        assertEquals(LocalDate.parse("2026-10-18"),weeks.getFirst().start().toLocalDate());
        assertTrue(weeks.getFirst().partial(),"The window starts on a Sunday, so its first bucket is truncated");
        for(var week:weeks) assertTrue(week.end().isAfter(week.start()),"No zero-length bucket is emitted");
        var last=weeks.getLast();
        assertEquals(LocalDateTime.parse("2026-11-09T00:00:00"),last.start());
        assertEquals(time,last.end());
        assertFalse(last.partial(),"The latest bucket is the complete week that just ended");
        assertEquals(LocalDate.parse("2026-11-09"),last.displayStart());
        assertEquals(LocalDate.parse("2026-11-15"),last.displayEnd());
    }

    @Test void displayDatesUseAnInclusiveLastDayForEveryBucket() {
        var time=LocalDateTime.parse("2026-11-17T16:00:00");
        var calculator=new DeliveryAnalyticsCalculator(new MainlandWorkCalendar());
        for(int days:new int[]{30,60,90}){
            for(var week:calculator.calculate(empty(),time,days).weeks()){
                assertEquals(week.start().toLocalDate(),week.displayStart(),"displayStart is the first day");
                assertEquals(week.end().minusSeconds(1).toLocalDate(),week.displayEnd(),"displayEnd is the inclusive last day");
                assertFalse(week.displayStart().isAfter(week.displayEnd()));
            }
        }
        var month=calculator.calculate(empty(),time,30).weeks();
        assertEquals(LocalDate.parse("2026-10-19"),month.getFirst().displayStart());
        assertEquals(LocalDate.parse("2026-10-25"),month.getFirst().displayEnd());
        assertEquals(LocalDate.parse("2026-11-16"),month.getLast().displayStart());
        assertEquals(LocalDate.parse("2026-11-17"),month.getLast().displayEnd());
    }

    @Test void naturalWeeksSplitAcrossAYearBoundary() {
        var calendar=new MainlandWorkCalendar(){
            @Override public boolean supports(LocalDate start,LocalDate end){return true;}
        };
        var time=LocalDateTime.parse("2027-01-06T12:00:00");
        var weeks=new DeliveryAnalyticsCalculator(calendar).calculate(empty(),time,90).weeks();
        var crossing=weeks.stream().filter(w->w.start().getYear()!=w.end().getYear()).findFirst().orElseThrow();
        assertEquals(LocalDateTime.parse("2026-12-28T00:00:00"),crossing.start());
        assertEquals(LocalDateTime.parse("2027-01-04T00:00:00"),crossing.end());
        assertEquals(LocalDate.parse("2026-12-28"),crossing.displayStart());
        assertEquals(LocalDate.parse("2027-01-03"),crossing.displayEnd());
        assertFalse(crossing.partial(),"The holiday week crossing New Year is still a full natural week");
        for(var week:weeks) assertTrue(week.end().isAfter(week.start()));
        assertEquals(LocalTime.MIDNIGHT,weeks.getLast().start().toLocalTime());
        assertEquals(DayOfWeek.MONDAY,weeks.getLast().start().getDayOfWeek());
    }

    @Test void bucketDeliveredSumsToTheHeadlineUnderNaturalWeeks() {
        var time=LocalDateTime.parse("2026-11-17T16:00:00");
        var base=LocalDateTime.parse("2026-10-20T10:00:00");
        var events=new ArrayList<Event>();
        long id=1;
        for(int i=0;i<10;i++) events.add(new Event(id++,i+1,"STATUS_CHANGE","HUMAN","IN_PROGRESS","DONE",null,base.plusDays(i*3L)));
        var data=new DeliveryAnalyticsData(events,List.of(),List.of(),List.of(),List.of(),List.of());
        var calculator=new DeliveryAnalyticsCalculator(new MainlandWorkCalendar());
        for(int days:new int[]{30,60,90}){
            var report=calculator.calculate(data,time,days);
            assertEquals(10,report.summary().delivered());
            assertEquals(report.summary().delivered(),
                report.weeks().stream().mapToLong(w->w.metrics().delivered()).sum(),
                "Buckets partition the window, so their delivered counts must reconcile with the headline");
        }
    }

}
