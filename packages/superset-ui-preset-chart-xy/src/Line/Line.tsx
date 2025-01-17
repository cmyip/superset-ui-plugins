/* eslint-disable sort-keys, no-magic-numbers, complexity */

import React, { PureComponent } from 'react';
import { kebabCase, groupBy, flatMap, uniqueId, values } from 'lodash';
import {
  AreaSeries,
  LinearGradient,
  LineSeries,
  XYChart,
  CrossHair,
  WithTooltip,
} from '@data-ui/xy-chart';
import { chartTheme } from '@data-ui/theme';
import { Margin, Dimension } from '@superset-ui/dimension';
import { WithLegend } from '@superset-ui/chart-composition';
import { createSelector } from 'reselect';
import Encoder, { Encoding, ChannelOutput } from './Encoder';
import { Dataset, PlainObject } from '../encodeable/types/Data';
import { PartialSpec } from '../encodeable/types/Specification';
import DefaultTooltipRenderer from './DefaultTooltipRenderer';
import createMarginSelector, { DEFAULT_MARGIN } from '../utils/selectors/createMarginSelector';
import convertScaleToDataUIScale from '../utils/convertScaleToDataUIScaleShape';
import createXYChartLayoutWithTheme from '../utils/createXYChartLayoutWithTheme';
import createEncoderSelector from '../encodeable/createEncoderSelector';
import createRenderLegend from '../components/legend/createRenderLegend';
import { LegendHooks } from '../components/legend/types';

export interface TooltipProps {
  encoder: Encoder;
  allSeries: Series[];
  datum: SeriesValue;
  series: {
    [key: string]: SeriesValue;
  };
  theme: typeof chartTheme;
}

const defaultProps = {
  className: '',
  margin: DEFAULT_MARGIN,
  theme: chartTheme,
  TooltipRenderer: DefaultTooltipRenderer,
};

/** Part of formData that is needed for rendering logic in this file */
export type FormDataProps = {
  margin?: Margin;
  theme?: typeof chartTheme;
} & PartialSpec<Encoding>;

export type HookProps = {
  TooltipRenderer?: React.ComponentType<TooltipProps>;
} & LegendHooks<Encoder>;

type Props = {
  className?: string;
  width: string | number;
  height: string | number;
  data: Dataset;
} & HookProps &
  FormDataProps &
  Readonly<typeof defaultProps>;

export interface Series {
  key: string;
  fill: ChannelOutput<'fill'>;
  stroke: ChannelOutput<'stroke'>;
  strokeDasharray: ChannelOutput<'strokeDasharray'>;
  strokeWidth: ChannelOutput<'strokeWidth'>;
  values: SeriesValue[];
}

export interface SeriesValue {
  x: number | Date;
  y: number;
  data: PlainObject;
  parent: Series;
}

const CIRCLE_STYLE = { strokeWidth: 1.5 };

export default class LineChart extends PureComponent<Props> {
  static defaultProps = defaultProps;

  private createEncoder = createEncoderSelector(Encoder);

  private createAllSeries = createSelector(
    (input: { encoder: Encoder; data: Dataset }) => input.encoder,
    input => input.data,
    (encoder, data) => {
      const { channels } = encoder;
      const fieldNames = encoder.getGroupBys();

      const groups = groupBy(data, row => fieldNames.map(f => `${f}=${row[f]}`).join(','));

      const allSeries = values(groups).map(seriesData => {
        const firstDatum = seriesData[0];
        const key = fieldNames.map(f => firstDatum[f]).join(',');
        const series: Series = {
          key: key.length === 0 ? channels.y.getTitle() : key,
          fill: channels.fill.encode(firstDatum, false),
          stroke: channels.stroke.encode(firstDatum, '#222'),
          strokeDasharray: channels.strokeDasharray.encode(firstDatum, ''),
          strokeWidth: channels.strokeWidth.encode(firstDatum, 1),
          values: [],
        };

        series.values = seriesData
          .map(v => ({
            x: channels.x.get<number | Date>(v),
            y: channels.y.get<number>(v),
            data: v,
            parent: series,
          }))
          .sort((a: SeriesValue, b: SeriesValue) => {
            const aTime = a.x instanceof Date ? a.x.getTime() : a.x;
            const bTime = b.x instanceof Date ? b.x.getTime() : b.x;

            return aTime - bTime;
          });

        return series;
      });

      return allSeries;
    },
  );

  private createMargin = createMarginSelector();

  constructor(props: Props) {
    super(props);

    this.renderChart = this.renderChart.bind(this);
  }

  renderSeries(allSeries: Series[]) {
    const filledSeries = flatMap(
      allSeries
        .filter(({ fill }) => fill)
        .map(series => {
          const gradientId = uniqueId(kebabCase(`gradient-${series.key}`));

          return [
            <LinearGradient
              key={`${series.key}-gradient`}
              id={gradientId}
              from={series.stroke}
              to="#fff"
            />,
            <AreaSeries
              key={`${series.key}-fill`}
              seriesKey={series.key}
              data={series.values}
              interpolation="linear"
              fill={`url(#${gradientId})`}
              stroke={series.stroke}
              strokeWidth={series.strokeWidth}
            />,
          ];
        }),
    );

    const unfilledSeries = allSeries
      .filter(({ fill }) => !fill)
      .map(series => (
        <LineSeries
          key={series.key}
          seriesKey={series.key}
          interpolation="linear"
          data={series.values}
          stroke={series.stroke}
          strokeDasharray={series.strokeDasharray}
          strokeWidth={series.strokeWidth}
        />
      ));

    return filledSeries.concat(unfilledSeries);
  }

  renderChart(dim: Dimension) {
    const { width, height } = dim;
    const { data, margin, theme, TooltipRenderer } = this.props;

    const encoder = this.createEncoder(this.props);
    const { channels } = encoder;

    if (typeof channels.x.scale !== 'undefined') {
      const xDomain = channels.x.getDomain(data);
      channels.x.scale.setDomain(xDomain);
    }
    if (typeof channels.y.scale !== 'undefined') {
      const yDomain = channels.y.getDomain(data);
      channels.y.scale.setDomain(yDomain);
    }

    const allSeries = this.createAllSeries({ encoder, data });

    const layout = createXYChartLayoutWithTheme({
      width,
      height,
      margin: this.createMargin(margin),
      theme,
      xEncoder: channels.x,
      yEncoder: channels.y,
    });

    return layout.renderChartWithFrame((chartDim: Dimension) => (
      <WithTooltip
        renderTooltip={({
          datum,
          series,
        }: {
          datum: SeriesValue;
          series: {
            [key: string]: SeriesValue;
          };
        }) => (
          <TooltipRenderer
            encoder={encoder}
            allSeries={allSeries}
            datum={datum}
            series={series}
            theme={theme}
          />
        )}
      >
        {({
          onMouseLeave,
          onMouseMove,
          tooltipData,
        }: {
          onMouseLeave: (...args: any[]) => void;
          onMouseMove: (...args: any[]) => void;
          tooltipData: any;
        }) => (
          <XYChart
            width={chartDim.width}
            height={chartDim.height}
            ariaLabel="LineChart"
            eventTrigger="container"
            margin={layout.margin}
            onMouseMove={onMouseMove}
            onMouseLeave={onMouseLeave}
            renderTooltip={null}
            showYGrid
            snapTooltipToDataX
            theme={theme}
            tooltipData={tooltipData}
            xScale={convertScaleToDataUIScale(channels.x.scale!.config)}
            yScale={convertScaleToDataUIScale(channels.y.scale!.config)}
          >
            {layout.renderXAxis()}
            {layout.renderYAxis()}
            {this.renderSeries(allSeries)}
            <CrossHair
              fullHeight
              strokeDasharray=""
              showHorizontalLine={false}
              circleFill={(d: SeriesValue) =>
                d.y === tooltipData.datum.y ? d.parent.stroke : '#fff'
              }
              circleSize={(d: SeriesValue) => (d.y === tooltipData.datum.y ? 6 : 4)}
              circleStroke={(d: SeriesValue) =>
                d.y === tooltipData.datum.y ? '#fff' : d.parent.stroke
              }
              circleStyles={CIRCLE_STYLE}
              stroke="#ccc"
              showCircle
              showMultipleCircles
            />
          </XYChart>
        )}
      </WithTooltip>
    ));
  }

  render() {
    const { className, data, width, height } = this.props;

    const encoder = this.createEncoder(this.props);

    return (
      <WithLegend
        className={`superset-chart-line ${className}`}
        width={width}
        height={height}
        position="top"
        renderLegend={createRenderLegend(encoder, data, this.props)}
        renderChart={this.renderChart}
      />
    );
  }
}
