/*
 * Canvas that renders the outlines of cell labels in a certain opacity
 */
import { useSelector } from '@xstate/react';
import { useEffect, useRef } from 'react';
import {
  useAlphaGpu,
  useArrays,
  useCanvas,
  useCellValueMapping,
  useChannel,
  useImage,
  useLabeled,
  useRaw,
} from '../ProjectContext';

const OutlineCanvas = ({ setBitmaps }) => {
  const canvas = useCanvas();
  const width = useSelector(canvas, (state) => state.context.width);
  const height = useSelector(canvas, (state) => state.context.height);

  const labeled = useLabeled();
  const opacity = useSelector(labeled, (state) => state.context.outlineOpacity);
  const feature = useSelector(labeled, (state) => state.context.feature);

  const raw = useRaw();
  const isGrayscale = useSelector(raw, (state) => state.context.isGrayscale);
  const channelIndex = useSelector(raw, (state) => state.context.channel);
  const channel = useChannel(channelIndex);
  const invert = useSelector(channel, (state) => state.context.invert && isGrayscale);

  const image = useImage();
  const t = useSelector(image, (state) => state.context.t);

  const arrays = useArrays();
  const labeledArray = useSelector(
    arrays,
    (state) => state.context.labeled && state.context.labeled[feature][t]
  );

  const { mapping, lengths } = useCellValueMapping();

  const gpu = useAlphaGpu();
  const kernelRef = useRef();

  /*
   * Color the pixel white at 'opacity' if both are true:
   * (1) the pixel value maps to a certain cell
   * (2) the pixel is adjacent to a pixel that doesn't map to that same cell
   * 'Mixes' (brightens) this if this is true for multiple cells
   */
  useEffect(() => {
    const kernel = gpu.createKernel(
      `function (data, mapping, lengths, opacity, invert) {
        const x = this.thread.x;
        const y = this.constants.h - 1 - this.thread.y;
        const value = data[y][x];
        let north = value;
        let south = value;
        let east = value;
        let west = value;
        if (x !== 0) {
          north = data[y][x - 1];
        }
        if (x !== this.constants.w - 1) {
          south = data[y][x + 1];
        }
        if (y !== 0) {
          west = data[y - 1][x];
        }
        if (y !== this.constants.h - 1) {
          east = data[y + 1][x];
        }
        let outlineOpacity = 1;

        const numCells = lengths[value];
        if (value > 0 && mapping[value][0] !== 0) {
          for (let i = 0; i < numCells; i++) {
            const currCell = mapping[value][i];
            let isOutline = 0;
            const numNorth = lengths[north];
            const numSouth = lengths[south];
            const numWest = lengths[west];
            const numEast = lengths[east];
            // Check if north pixel contains current cell or not
            for (let j = 0; j < numNorth; j++) {
              const northCell = mapping[north][j];
              if (northCell !== currCell) {
                isOutline = isOutline + 1;
              }
            }
            if (isOutline === numNorth) {
              outlineOpacity = outlineOpacity * (1 - opacity);
            } else {
              isOutline = 0;
              // Check if south pixel contains current cell or not
              for (let j = 0; j < numSouth; j++) {
                const southCell = mapping[south][j];
                if (southCell !== currCell) {
                  isOutline = isOutline + 1;
                }
              }
              if (isOutline === numSouth) {
                outlineOpacity = outlineOpacity * (1 - opacity);
              } else {
                isOutline = 0;
                // Check if west pixel contains current cell or not
                for (let j = 0; j < numWest; j++) {
                  const westCell = mapping[west][j];
                  if (westCell !== currCell) {
                    isOutline = isOutline + 1;
                  }
                }
                if (isOutline === numWest) {
                  outlineOpacity = outlineOpacity * (1 - opacity);
                } else {
                  isOutline = 0;
                  // Check if east pixel contains current cell or not
                  for (let j = 0; j < numEast; j++) {
                    const eastCell = mapping[east][j];
                    if (eastCell !== currCell) {
                      isOutline = isOutline + 1;
                    }
                  }
                  if (isOutline === numEast) {
                    outlineOpacity = outlineOpacity * (1 - opacity);
                  }
                }
              }
            }
          }
        }
        let [r, g, b] = [1, 1, 1];
        if (invert) {
          r = 0;
          g = 0;
          b = 0;
        }
        this.color(r, g, b, 1 - outlineOpacity);
      }`,
      {
        constants: { w: width, h: height },
        output: [width, height],
        graphical: true,
        dynamicArguments: true,
        loopMaxIterations: 5000, // Maximum number of outlines to render
      }
    );
    kernelRef.current = kernel;
  }, [gpu, width, height]);

  useEffect(() => {
    const kernel = kernelRef.current;
    if (labeledArray && mapping && lengths) {
      // Compute the outline of the labels with the kernel
      kernel(labeledArray, mapping, lengths, opacity, invert);
      // Rerender the parent canvas
      createImageBitmap(kernel.canvas).then((bitmap) => {
        setBitmaps((bitmaps) => ({ ...bitmaps, outline: bitmap }));
      });
    }
  }, [labeledArray, mapping, lengths, opacity, invert, setBitmaps, width, height]);

  return null;
};

export default OutlineCanvas;
