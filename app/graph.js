import document from 'document';

export default class Graph {

  constructor(id, minY, maxY) {
    const graphEl = document.getElementById(id);
    this.graphHeight = graphEl.getElementById("graph-container").height;
    this.points = graphEl.getElementsByClassName("graph-point");
    this.highLabel = graphEl.getElementById("graph-label-high");
    this.midLabel = graphEl.getElementById("graph-label-middle");
    this.lowLabel = graphEl.getElementById("graph-label-low");
    this.vals = [];
    this.setYRange(minY, maxY);
  }

  setYRange(minY, maxY){
    this.minY = minY;
    this.maxY = maxY;
    this.scaleY = (maxY - minY) / this.graphHeight;
    
    this.highLabel.text = maxY;
    this.midLabel.text = Math.round((maxY - minY) / 2);
    this.lowLabel.text = minY;
  }

  addValue(newValue) {
    // TODO round min and max so that points aren't at the edge of the graph
    if (newValue.y < this.minY) {
      this.setYRange(newValue.y, this.maxY);
    } else if (newValue.y > this.maxY) {
      this.setYRange(this.minY, newValue.y);
    }

    // Remove first value in array
    if (this.vals.length === this.points.length) {
      this.vals.splice(0, 1);
    }
    // Add point to end of array
    this.vals.push(newValue);

    this.updatePoints();
  }
  
  setValues(vals) {
    if (!vals) {
      return;
    }
    this.vals = vals;
    this.updatePoints();
  }
  
  getValues() {
    return this.vals;
  }

  updatePoints() {
    for (let i = 0; i < this.points.length; i++) {
      const point = this.points[i];
      if (i < this.vals.length) {
        const val = this.vals[i];
        point.cy = this.graphHeight - ((val.y - this.minY) / this.scaleY);
        point.style.fill = val.fill || '#ffffff';
        point.style.visibility = 'visible';
      } else {
        point.style.visibility = 'hidden';
      }
    }
  }
};
